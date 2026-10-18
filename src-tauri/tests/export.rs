//! Executor de exportação com o FFmpeg real: progresso, arquivo final,
//! falha sem sobras e cancelamento no meio. Ignorado sem FFmpeg.

use novacut_lib::export::{run_export, temp_output, working_h264_encoders, ExportError};
use novacut_lib::ffmpeg;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

fn available() -> bool {
    let ok = ffmpeg::locate("ffmpeg").is_some();
    if !ok {
        eprintln!("FFmpeg ausente; teste ignorado");
    }
    ok
}

fn args_for(source: &str, seconds: u32, output: &std::path::Path) -> Vec<String> {
    vec![
        "-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", source,
        "-f", "lavfi", "-i", &format!("sine=duration={seconds}"),
        "-c:v", "libopenh264", "-c:a", "aac", "-t", &seconds.to_string(),
        "-progress", "pipe:1", "-nostats",
    ]
    .into_iter()
    .map(String::from)
    .chain([output.to_string_lossy().into_owned()])
    .collect()
}

#[test]
fn exports_with_progress_and_final_file() {
    if !available() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("filme final.mp4");
    let mut events = Vec::new();
    let r = run_export(
        &args_for("testsrc2=size=320x180:rate=30:duration=3", 3, &out),
        &out,
        Arc::new(AtomicBool::new(false)),
        |p| events.push(p),
    );
    assert_eq!(r, Ok(()));
    assert!(out.is_file(), "arquivo final ausente");
    assert!(!temp_output(&out).exists(), "temporário sobrou");
    assert!(events.last().unwrap().done, "último evento deve ser progress=end");
    assert!(events.last().unwrap().out_time_us >= 2_900_000);
    assert!(events.windows(2).all(|w| w[0].out_time_us <= w[1].out_time_us), "progresso deve ser crescente");
}

#[test]
fn failure_reports_ffmpeg_error_and_leaves_nothing() {
    if !available() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("x.mp4");
    let mut args = args_for("testsrc2=size=320x180:rate=30:duration=1", 1, &out);
    let i = args.iter().position(|a| a == "libopenh264").unwrap();
    args[i] = "encoder_inexistente".into();
    match run_export(&args, &out, Arc::new(AtomicBool::new(false)), |_| {}) {
        Err(ExportError::Failed(msg)) => assert!(msg.contains("encoder_inexistente"), "{msg}"),
        other => panic!("esperava falha, veio {other:?}"),
    }
    assert!(!out.exists() && !temp_output(&out).exists());
}

#[test]
fn cancel_midway_leaves_no_files() {
    if !available() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("longo.mp4");
    let cancel = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&cancel);
    let mut seen = 0;
    let r = run_export(
        &args_for("testsrc2=size=1920x1080:rate=30:duration=120", 120, &out),
        &out,
        cancel,
        |p| {
            seen += 1;
            if p.out_time_us > 0 {
                flag.store(true, Ordering::SeqCst); // cancela no primeiro progresso real
            }
        },
    );
    assert_eq!(r, Err(ExportError::Cancelled));
    assert!(seen >= 1);
    assert!(!out.exists(), "não pode existir arquivo final após cancelar");
    assert!(!temp_output(&out).exists(), "o temporário deve ser apagado");
}

#[test]
fn rejects_wrong_output() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("x.mov");
    let args = vec!["-i".to_string(), "a".into(), out.to_string_lossy().into_owned()];
    assert!(matches!(run_export(&args, &out, Arc::new(AtomicBool::new(false)), |_| {}), Err(ExportError::Failed(_))));
    let other = dir.path().join("y.mp4");
    assert!(matches!(run_export(&args, &other, Arc::new(AtomicBool::new(false)), |_| {}), Err(ExportError::Failed(_))));
}

#[test]
fn detects_working_encoders() {
    if !available() {
        return;
    }
    let working = working_h264_encoders();
    eprintln!("encoders funcionando: {working:?}");
    assert!(working.iter().any(|e| e == "libopenh264"), "{working:?}");
    // Sem GPU NVIDIA, o NVENC compilado não pode ser oferecido.
    let has_nvidia = std::process::Command::new("nvidia-smi").output().is_ok_and(|o| o.status.success());
    if !has_nvidia {
        assert!(!working.iter().any(|e| e == "h264_nvenc"), "{working:?}");
    }
}
