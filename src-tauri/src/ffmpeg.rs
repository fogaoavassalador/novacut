//! Localização e diagnóstico do FFmpeg usado pelo NovaCut.
//!
//! O FFmpeg roda sempre como processo separado; nunca é linkado ao app.
//! Ordem de busca: variável `NOVACUT_FFMPEG_DIR`, depois o PATH do sistema.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Encoders H.264 que o NovaCut sabe usar, em ordem de preferência.
pub const H264_ENCODERS: &[&str] = &[
    "h264_amf",
    "h264_nvenc",
    "h264_qsv",
    "h264_mf",
    "libopenh264",
    "libx264",
];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub found: bool,
    /// Origem do ffmpeg encontrado (substituição, embutido ou PATH).
    pub source: Option<Source>,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub version: Option<String>,
    /// "GPL", "LGPLv3" ou "LGPLv2.1", deduzido das flags de configuração.
    pub license: Option<String>,
    /// Encoders H.264 compilados no binário. Estar na lista não garante que o
    /// hardware correspondente exista nesta máquina.
    pub h264_encoders: Vec<String>,
    pub error: Option<String>,
}

impl FfmpegStatus {
    pub fn missing(error: impl Into<String>) -> Self {
        Self {
            found: false,
            source: None,
            ffmpeg_path: None,
            ffprobe_path: None,
            version: None,
            license: None,
            h264_encoders: Vec::new(),
            error: Some(error.into()),
        }
    }
}

fn exe_name(tool: &str) -> String {
    if cfg!(windows) {
        format!("{tool}.exe")
    } else {
        tool.to_string()
    }
}

fn find_in_dir(dir: &Path, tool: &str) -> Option<PathBuf> {
    let candidate = dir.join(exe_name(tool));
    candidate.is_file().then_some(candidate)
}

/// Pasta do FFmpeg distribuído com o app (recursos do instalador), definida na inicialização.
static BUNDLED_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Registra a pasta do FFmpeg embutido (chamado uma vez, na inicialização do app).
pub fn set_bundled_dir(dir: PathBuf) {
    let _ = BUNDLED_DIR.set(dir);
}

/// De onde veio o executável encontrado.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// `NOVACUT_FFMPEG_DIR` (substituição explícita).
    Env,
    /// Distribuído com o app.
    Bundled,
    /// PATH do sistema.
    Path,
}

/// Procura `tool` (ex.: "ffmpeg"): `NOVACUT_FFMPEG_DIR`, depois o FFmpeg
/// embutido no app, depois o PATH.
pub fn locate_with_source(tool: &str) -> Option<(PathBuf, Source)> {
    if let Some(dir) = std::env::var_os("NOVACUT_FFMPEG_DIR") {
        if let Some(p) = find_in_dir(Path::new(&dir), tool) {
            return Some((p, Source::Env));
        }
    }
    if let Some(p) = BUNDLED_DIR.get().and_then(|d| find_in_dir(d, tool)) {
        return Some((p, Source::Bundled));
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| find_in_dir(&dir, tool)).map(|p| (p, Source::Path))
}

pub fn locate(tool: &str) -> Option<PathBuf> {
    locate_with_source(tool).map(|(p, _)| p)
}

/// Cria um `Command` que não abre janela de console no Windows.
pub fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Extrai "8.1.2-50-g1a748fe2cd-20260831" de "ffmpeg version 8.1.2-... Copyright ...".
pub fn parse_version(version_output: &str) -> Option<String> {
    let line = version_output.lines().next()?;
    let rest = line.strip_prefix("ffmpeg version ")?;
    let v = rest.split_whitespace().next()?;
    Some(v.trim_start_matches('n').to_string())
}

pub fn parse_license(version_output: &str) -> Option<String> {
    let config = version_output
        .lines()
        .find(|l| l.trim_start().starts_with("configuration:"))?;
    let has = |flag: &str| config.split_whitespace().any(|t| t == flag);
    Some(
        if has("--enable-gpl") {
            "GPL"
        } else if has("--enable-version3") {
            "LGPLv3"
        } else {
            "LGPLv2.1"
        }
        .to_string(),
    )
}

/// Filtra, na saída de `ffmpeg -encoders`, os encoders H.264 conhecidos.
pub fn parse_h264_encoders(encoders_output: &str) -> Vec<String> {
    let listed: Vec<&str> = encoders_output
        .lines()
        .filter_map(|l| {
            let mut parts = l.split_whitespace();
            let flags = parts.next()?;
            let name = parts.next()?;
            // Linhas de encoder começam com 6 flags, sendo a primeira o tipo (V/A/S).
            (flags.len() == 6 && flags.starts_with('V')).then_some(name)
        })
        .collect();
    H264_ENCODERS
        .iter()
        .filter(|e| listed.contains(e))
        .map(|e| e.to_string())
        .collect()
}

/// Executa `program args`, coletando stdout. Mata o processo se passar de `timeout`.
pub fn run_with_timeout(
    program: &Path,
    args: &[&std::ffi::OsStr],
    timeout: std::time::Duration,
) -> Result<Vec<u8>, String> {
    use std::io::Read;
    use std::process::Stdio;

    let name = program.file_name().unwrap_or_default().to_string_lossy().into_owned();
    let mut child = command(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("falha ao executar {name}: {e}"))?;

    // Leitura em threads: se o pipe encher sem ninguém ler, o processo trava.
    let mut out = child.stdout.take().expect("stdout piped");
    let mut err = child.stderr.take().expect("stderr piped");
    let out_t = std::thread::spawn(move || {
        let mut b = Vec::new();
        out.read_to_end(&mut b).map(|_| b)
    });
    let err_t = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = err.read_to_string(&mut s);
        s
    });

    let start = std::time::Instant::now();
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{name} excedeu o tempo limite de {}s", timeout.as_secs()));
            }
            None => std::thread::sleep(std::time::Duration::from_millis(10)),
        }
    };
    let stdout = out_t.join().map_err(|_| "falha ao ler saída".to_string())?.map_err(|e| e.to_string())?;
    let stderr = err_t.join().unwrap_or_default();
    if !status.success() {
        let msg = stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("erro desconhecido");
        return Err(format!("{name} falhou: {}", msg.trim()));
    }
    Ok(stdout)
}

fn run_capture(program: &Path, args: &[&str]) -> Result<String, String> {
    let out = command(program)
        .args(args)
        .output()
        .map_err(|e| format!("falha ao executar {}: {e}", program.display()))?;
    if !out.status.success() {
        return Err(format!(
            "{} terminou com {}: {}",
            program.display(),
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub fn status() -> FfmpegStatus {
    let Some((ffmpeg, source)) = locate_with_source("ffmpeg") else {
        return FfmpegStatus::missing(
            "ffmpeg não encontrado (defina NOVACUT_FFMPEG_DIR ou adicione ao PATH)",
        );
    };
    let ffprobe = locate("ffprobe");

    let version_out = match run_capture(&ffmpeg, &["-hide_banner", "-version"]) {
        Ok(s) => s,
        Err(e) => return FfmpegStatus::missing(e),
    };
    let encoders = run_capture(&ffmpeg, &["-hide_banner", "-encoders"])
        .map(|s| parse_h264_encoders(&s))
        .unwrap_or_default();

    FfmpegStatus {
        found: true,
        source: Some(source),
        ffmpeg_path: Some(ffmpeg.display().to_string()),
        ffprobe_path: ffprobe.as_ref().map(|p| p.display().to_string()),
        version: parse_version(&version_out),
        license: parse_license(&version_out),
        h264_encoders: encoders,
        error: ffprobe
            .is_none()
            .then(|| "ffprobe não encontrado".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VERSION_LGPL: &str = "ffmpeg version n8.1.2-50-g1a748fe2cd-20260831 Copyright (c) 2000-2026 the FFmpeg developers\nbuilt with gcc 15.2.0\nconfiguration: --prefix=/ffbuild/prefix --enable-version3 --enable-amf --disable-libx264\n";
    const VERSION_GPL: &str = "ffmpeg version 7.1-full_build-www.gyan.dev Copyright\nconfiguration: --enable-gpl --enable-version3 --enable-libx264\n";

    #[test]
    fn parses_version() {
        assert_eq!(
            parse_version(VERSION_LGPL).as_deref(),
            Some("8.1.2-50-g1a748fe2cd-20260831")
        );
        assert_eq!(parse_version("lixo").as_deref(), None);
    }

    #[test]
    fn detects_license() {
        assert_eq!(parse_license(VERSION_LGPL).as_deref(), Some("LGPLv3"));
        assert_eq!(parse_license(VERSION_GPL).as_deref(), Some("GPL"));
        assert_eq!(
            parse_license("ffmpeg version x\nconfiguration: --enable-shared\n").as_deref(),
            Some("LGPLv2.1")
        );
    }

    #[test]
    fn filters_h264_encoders_in_preference_order() {
        let out = "Encoders:\n V..... = Video\n ------\n V....D libopenh264          OpenH264\n V....D h264_amf             AMD AMF\n V....D h264_mf              MF\n A....D aac                  AAC\n V....D hevc_amf             HEVC\n";
        assert_eq!(
            parse_h264_encoders(out),
            vec!["h264_amf", "h264_mf", "libopenh264"]
        );
    }

    /// Teste de integração: só roda se houver FFmpeg na máquina.
    #[test]
    fn real_ffmpeg_if_available() {
        if locate("ffmpeg").is_none() {
            eprintln!("ffmpeg ausente; teste ignorado");
            return;
        }
        let s = status();
        assert!(s.found, "{:?}", s.error);
        assert!(s.version.is_some());
        assert!(s.license.is_some());
    }
}
