//! Ordem de busca do FFmpeg: NOVACUT_FFMPEG_DIR > embutido no app > PATH.
//! Um único teste por processo, porque mexe em estado global (variável de
//! ambiente e pasta embutida).

use novacut_lib::ffmpeg::{locate_with_source, set_bundled_dir, Source};

#[test]
fn search_order_env_then_bundled_then_path() {
    let bundled = tempfile::tempdir().unwrap();
    let override_dir = tempfile::tempdir().unwrap();
    for d in [bundled.path(), override_dir.path()] {
        std::fs::write(d.join("ffmpeg.exe"), b"").unwrap();
    }
    // SAFETY: este binário de teste tem uma única thread de teste.
    unsafe { std::env::remove_var("NOVACUT_FFMPEG_DIR") };

    let before = locate_with_source("ffmpeg").map(|(_, s)| s);
    assert!(matches!(before, None | Some(Source::Path)), "sem embutido: PATH ou nada");

    set_bundled_dir(bundled.path().to_path_buf());
    let (p, s) = locate_with_source("ffmpeg").unwrap();
    assert_eq!((p, s), (bundled.path().join("ffmpeg.exe"), Source::Bundled), "embutido vence o PATH");

    unsafe { std::env::set_var("NOVACUT_FFMPEG_DIR", override_dir.path()) };
    let (p, s) = locate_with_source("ffmpeg").unwrap();
    assert_eq!((p, s), (override_dir.path().join("ffmpeg.exe"), Source::Env), "substituição explícita vence tudo");

    // A pasta de substituição não tem ffprobe.exe: ele vem do embutido.
    std::fs::write(bundled.path().join("ffprobe.exe"), b"").unwrap();
    let (p, s) = locate_with_source("ffprobe").unwrap();
    assert_eq!((p, s), (bundled.path().join("ffprobe.exe"), Source::Bundled));
    unsafe { std::env::remove_var("NOVACUT_FFMPEG_DIR") };
}
