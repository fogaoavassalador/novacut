//! Execução da exportação: roda o FFmpeg com os argumentos gerados pelo
//! core (src/core/export/ffmpegArgs.ts), lê o progresso (`-progress pipe:1`),
//! permite cancelar e só entrega o arquivo final se tudo der certo.

use crate::ffmpeg;
use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub out_time_us: u64,
    /// Velocidade em relação ao tempo real (ex.: 3.2 = 3,2× mais rápido).
    pub speed: Option<f64>,
    pub done: bool,
}

/// Interpreta um bloco `chave=valor` do `-progress` (termina em `progress=…`).
pub fn parse_progress(lines: &[String]) -> Option<Progress> {
    let mut p = Progress::default();
    let mut complete = false;
    for line in lines {
        let Some((k, v)) = line.trim().split_once('=') else { continue };
        match k {
            // out_time_us e out_time_ms trazem microssegundos (nome histórico do FFmpeg).
            "out_time_us" | "out_time_ms" => {
                if let Ok(us) = v.parse::<i64>() {
                    p.out_time_us = us.max(0) as u64;
                }
            }
            "speed" => p.speed = v.trim_end_matches('x').trim().parse().ok(),
            "progress" => {
                complete = true;
                p.done = v == "end";
            }
            _ => {}
        }
    }
    complete.then_some(p)
}

#[derive(Debug, PartialEq)]
pub enum ExportError {
    Cancelled,
    Failed(String),
}

/// Caminho temporário ao lado do destino (mesmo volume, para o rename ser atômico).
pub fn temp_output(output: &Path) -> PathBuf {
    let stem = output.file_stem().unwrap_or_default().to_string_lossy();
    output.with_file_name(format!("{stem}.novacut-part.mp4"))
}

/// Executa o FFmpeg. `args` termina no caminho de saída final, que é trocado
/// por um temporário; ao concluir com sucesso o temporário é renomeado.
pub fn run_export(
    args: &[String],
    output: &Path,
    cancel: Arc<AtomicBool>,
    mut on_progress: impl FnMut(Progress),
) -> Result<(), ExportError> {
    let fail = |m: String| Err(ExportError::Failed(m));
    if args.last().map(Path::new) != Some(output) {
        return fail("o último argumento deve ser o arquivo de saída".into());
    }
    if !output.extension().is_some_and(|e| e.eq_ignore_ascii_case("mp4")) {
        return fail("o arquivo de saída precisa ter extensão .mp4".into());
    }
    let ffmpeg_bin = ffmpeg::locate("ffmpeg").ok_or_else(|| ExportError::Failed("ffmpeg não encontrado".into()))?;
    let tmp = temp_output(output);
    let mut argv: Vec<String> = args.to_vec();
    *argv.last_mut().unwrap() = tmp.to_string_lossy().into_owned();

    let mut child = ffmpeg::command(&ffmpeg_bin)
        .args(&argv)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ExportError::Failed(format!("falha ao iniciar o ffmpeg: {e}")))?;

    // stderr: guarda as últimas linhas para explicar uma falha.
    let mut stderr = child.stderr.take().unwrap();
    let err_t = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        let lines: Vec<&str> = s.lines().filter(|l| !l.trim().is_empty()).collect();
        lines[lines.len().saturating_sub(12)..].join("\n")
    });

    let child = Arc::new(Mutex::new(child));
    // Vigia de cancelamento: mata o processo assim que pedido.
    let watcher = {
        let child = Arc::clone(&child);
        let cancel = Arc::clone(&cancel);
        std::thread::spawn(move || loop {
            {
                let mut c = child.lock().unwrap();
                if let Ok(Some(_)) = c.try_wait() {
                    return;
                }
                if cancel.load(Ordering::SeqCst) {
                    let _ = c.kill();
                    let _ = c.wait();
                    return;
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        })
    };

    let stdout = child.lock().unwrap().stdout.take().unwrap();
    let mut block = Vec::new();
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let is_end = line.starts_with("progress=");
        block.push(line);
        if is_end {
            if let Some(p) = parse_progress(&block) {
                on_progress(p);
            }
            block.clear();
        }
    }

    let _ = watcher.join();
    let status = child.lock().unwrap().wait();
    let stderr_tail = err_t.join().unwrap_or_default();

    let result = if cancel.load(Ordering::SeqCst) {
        Err(ExportError::Cancelled)
    } else {
        match status {
            Ok(s) if s.success() => std::fs::rename(&tmp, output)
                .map_err(|e| ExportError::Failed(format!("não foi possível gravar {}: {e}", output.display()))),
            Ok(s) => Err(ExportError::Failed(format!("o ffmpeg terminou com {s}:\n{stderr_tail}"))),
            Err(e) => Err(ExportError::Failed(e.to_string())),
        }
    };
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Encoders H.264 que realmente funcionam nesta máquina (compilado ≠ hardware
/// presente): cada candidato codifica um vídeo minúsculo de teste.
pub fn working_h264_encoders() -> Vec<String> {
    static CACHE: Mutex<Option<Vec<String>>> = Mutex::new(None);
    if let Some(v) = CACHE.lock().unwrap().clone() {
        return v;
    }
    let Some(bin) = ffmpeg::locate("ffmpeg") else { return Vec::new() };
    let compiled = ffmpeg::status().h264_encoders;
    let working: Vec<String> = ffmpeg::H264_ENCODERS
        .iter()
        .filter(|e| compiled.iter().any(|c| c == *e))
        .filter(|enc| {
            let args: Vec<std::ffi::OsString> = [
                "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=256x144:r=30:d=0.2",
                "-pix_fmt", "yuv420p", "-c:v", enc, "-f", "null", "-",
            ]
            .iter()
            .map(Into::into)
            .collect();
            let refs: Vec<&std::ffi::OsStr> = args.iter().map(|a| a.as_os_str()).collect();
            ffmpeg::run_with_timeout(&bin, &refs, Duration::from_secs(15)).is_ok()
        })
        .map(|e| e.to_string())
        .collect();
    *CACHE.lock().unwrap() = Some(working.clone());
    working
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(s: &str) -> Vec<String> {
        s.lines().map(String::from).collect()
    }

    #[test]
    fn parses_progress_blocks() {
        let p = parse_progress(&lines("frame=30\nout_time_us=1000000\nout_time_ms=1000000\nspeed=2.5x\nprogress=continue")).unwrap();
        assert_eq!(p, Progress { out_time_us: 1_000_000, speed: Some(2.5), done: false });
        let end = parse_progress(&lines("out_time_us=6000000\nspeed=N/A\nprogress=end")).unwrap();
        assert_eq!(end, Progress { out_time_us: 6_000_000, speed: None, done: true });
        // bloco incompleto (sem progress=) não gera evento
        assert_eq!(parse_progress(&lines("out_time_us=1")), None);
        // início do FFmpeg pode reportar tempo negativo
        assert_eq!(parse_progress(&lines("out_time_us=-23219\nprogress=continue")).unwrap().out_time_us, 0);
    }

    #[test]
    fn temp_output_is_next_to_destination() {
        let t = temp_output(Path::new(r"C:\vídeos\Meu filme.mp4"));
        assert_eq!(t, Path::new(r"C:\vídeos\Meu filme.novacut-part.mp4"));
    }
}
