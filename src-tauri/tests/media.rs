//! Integração com o FFmpeg real: gera mídias sintéticas (testsrc/sine) num
//! diretório temporário e verifica probe e miniaturas. Sem FFmpeg, os testes
//! são ignorados com aviso.

use novacut_lib::ffmpeg;
use novacut_lib::media::{self, MediaKind};
use std::path::{Path, PathBuf};
use std::process::Command;

fn ffmpeg_available() -> bool {
    let ok = ffmpeg::locate("ffmpeg").is_some() && ffmpeg::locate("ffprobe").is_some();
    if !ok {
        eprintln!("FFmpeg ausente; teste ignorado");
    }
    ok
}

fn generate(dir: &Path, name: &str, args: &[&str]) -> PathBuf {
    let out = dir.join(name);
    let status = Command::new(ffmpeg::locate("ffmpeg").unwrap())
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args(args)
        .arg(&out)
        .status()
        .unwrap();
    assert!(status.success(), "falha ao gerar {name}");
    out
}

#[test]
fn probes_real_files() {
    if !ffmpeg_available() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();
    let video = generate(
        d,
        "vídeo com áudio.mp4", // nome com acento e espaço de propósito
        &[
            "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=3",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
            "-c:v", "libopenh264", "-c:a", "aac", "-shortest",
        ],
    );
    let wav = generate(d, "a.wav", &["-f", "lavfi", "-i", "sine=duration=2"]);
    let png = generate(d, "i.png", &["-f", "lavfi", "-i", "testsrc2=size=320x240", "-frames:v", "1"]);
    let gif = generate(d, "g.gif", &["-f", "lavfi", "-i", "testsrc2=size=160x120:rate=10:duration=1"]);
    let rotated = generate(d, "rot.mp4", &["-display_rotation", "90", "-i", video.to_str().unwrap(), "-c", "copy"]);

    let v = media::probe(&video).unwrap();
    assert_eq!(v.kind, MediaKind::Video);
    assert_eq!(v.duration_us, Some(3_000_000));
    assert_eq!((v.width, v.height, v.fps), (Some(640), Some(360), Some(25.0)));
    assert!(v.has_audio);

    let a = media::probe(&wav).unwrap();
    assert_eq!((a.kind, a.duration_us), (MediaKind::Audio, Some(2_000_000)));

    let i = media::probe(&png).unwrap();
    assert_eq!((i.kind, i.duration_us, i.width), (MediaKind::Image, None, Some(320)));

    let g = media::probe(&gif).unwrap();
    assert_eq!(g.kind, MediaKind::Video, "GIF animado é tratado como vídeo");

    let r = media::probe(&rotated).unwrap();
    assert_eq!(r.rotation, 90);
    assert_eq!((r.width, r.height), (Some(360), Some(640)));
}

#[test]
fn rejects_non_media_and_missing_files() {
    if !ffmpeg_available() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let txt = dir.path().join("notas.txt");
    std::fs::write(&txt, "isto não é um vídeo").unwrap();
    assert!(media::probe(&txt).is_err());

    let missing = media::probe(&dir.path().join("sumiu.mp4")).unwrap_err();
    assert!(missing.contains("não encontrado"), "{missing}");
}

#[test]
fn thumbnails_are_jpeg_with_expected_width() {
    if !ffmpeg_available() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let video = generate(
        dir.path(),
        "v.mp4",
        &["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=2", "-c:v", "libopenh264"],
    );
    let png = generate(dir.path(), "i.png", &["-f", "lavfi", "-i", "testsrc2=size=800x600", "-frames:v", "1"]);

    for (path, at) in [(&video, 1_000_000u64), (&png, 0)] {
        let jpeg = media::thumbnail(path, at).unwrap();
        assert!(jpeg.starts_with(&[0xFF, 0xD8]), "não é JPEG");
        // Largura no cabeçalho SOF0 (FFC0): altura em +5, largura em +7.
        let sof = jpeg.windows(2).position(|w| w == [0xFF, 0xC0]).expect("sem SOF0");
        let width = u16::from_be_bytes([jpeg[sof + 7], jpeg[sof + 8]]);
        assert_eq!(width as u32, media::THUMB_WIDTH);
    }

    // Instante além do fim do vídeo: erro claro em vez de imagem vazia.
    assert!(media::thumbnail(&video, 60_000_000).is_err());
}
