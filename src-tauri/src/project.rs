//! Leitura e gravação de arquivos de projeto (.ncproj).
//!
//! A validação do conteúdo fica no core TypeScript (fonte única do schema);
//! aqui tratamos apenas de E/S segura: extensão, limite de tamanho, UTF-8 e
//! gravação atômica (arquivo temporário + rename), para que uma falha no meio
//! da gravação nunca deixe o projeto corrompido.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

pub const EXTENSION: &str = "ncproj";
/// Projetos são JSON pequenos; 64 MiB é uma margem muito acima do uso real.
pub const MAX_BYTES: u64 = 64 * 1024 * 1024;

fn check_extension(path: &Path) -> Result<(), String> {
    let ok = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(EXTENSION));
    if ok {
        Ok(())
    } else {
        Err(format!("o arquivo precisa ter a extensão .{EXTENSION}"))
    }
}

fn temp_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    path.with_file_name(name)
}

pub fn save(path: &Path, contents: &str) -> Result<(), String> {
    check_extension(path)?;
    if contents.len() as u64 > MAX_BYTES {
        return Err("projeto grande demais para salvar".into());
    }
    let tmp = temp_path(path);
    let result = (|| -> std::io::Result<()> {
        let mut f = File::create(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
        drop(f);
        // No Windows, fs::rename substitui o destino existente (MOVEFILE_REPLACE_EXISTING).
        fs::rename(&tmp, path)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(format!("não foi possível salvar {}: {e}", path.display()));
    }
    Ok(())
}

pub fn load(path: &Path) -> Result<String, String> {
    check_extension(path)?;
    let meta = fs::metadata(path).map_err(|e| format!("não foi possível abrir {}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("{} não é um arquivo", path.display()));
    }
    if meta.len() > MAX_BYTES {
        return Err("arquivo grande demais para ser um projeto NovaCut".into());
    }
    let bytes = fs::read(path).map_err(|e| format!("falha ao ler {}: {e}", path.display()))?;
    String::from_utf8(bytes).map_err(|_| "o arquivo não está em UTF-8".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_then_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("meu projeto.ncproj");
        save(&p, "{\"a\":\"ção\"}\n").unwrap();
        assert_eq!(load(&p).unwrap(), "{\"a\":\"ção\"}\n");
        assert!(!temp_path(&p).exists(), "arquivo temporário deve sumir");
    }

    #[test]
    fn save_overwrites_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.ncproj");
        save(&p, "primeiro").unwrap();
        save(&p, "segundo").unwrap();
        assert_eq!(load(&p).unwrap(), "segundo");
    }

    #[test]
    fn failed_save_keeps_previous_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.ncproj");
        save(&p, "original").unwrap();
        // Uma pasta no lugar do .tmp força a falha antes do rename.
        fs::create_dir(temp_path(&p)).unwrap();
        assert!(save(&p, "novo").is_err());
        assert_eq!(load(&p).unwrap(), "original");
    }

    #[test]
    fn rejects_wrong_extension() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.json");
        assert!(save(&p, "{}").unwrap_err().contains(".ncproj"));
        fs::write(&p, "{}").unwrap();
        assert!(load(&p).is_err());
    }

    #[test]
    fn extension_is_case_insensitive() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("X.NCPROJ");
        save(&p, "ok").unwrap();
        assert_eq!(load(&p).unwrap(), "ok");
    }

    #[test]
    fn rejects_non_utf8_and_missing() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("bin.ncproj");
        fs::write(&p, [0xff, 0xfe, 0x00]).unwrap();
        assert!(load(&p).unwrap_err().contains("UTF-8"));
        assert!(load(&dir.path().join("nao_existe.ncproj")).is_err());
    }
}
