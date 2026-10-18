//! Análise de mídia (ffprobe) e geração de miniaturas (ffmpeg).

use crate::ffmpeg;
use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::path::Path;
use std::time::Duration;

const PROBE_TIMEOUT: Duration = Duration::from_secs(20);
const THUMB_TIMEOUT: Duration = Duration::from_secs(20);
pub const THUMB_WIDTH: u32 = 320;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Video,
    Audio,
    Image,
}

/// Resultado da análise, já interpretado. Espelhado em src/platform/media.ts.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbe {
    pub kind: MediaKind,
    /// `None` para imagens.
    pub duration_us: Option<u64>,
    /// Dimensões de exibição (já considerando rotação).
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    /// Rotação de exibição em graus (0, 90, 180, 270).
    pub rotation: u32,
    pub has_video: bool,
    pub has_audio: bool,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub container: String,
}

// ---- JSON bruto do ffprobe (apenas os campos usados) ----

#[derive(Deserialize)]
struct RawProbe {
    #[serde(default)]
    streams: Vec<RawStream>,
    format: Option<RawFormat>,
}

#[derive(Deserialize)]
struct RawFormat {
    format_name: String,
    duration: Option<String>,
}

#[derive(Deserialize)]
struct RawStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
    duration: Option<String>,
    sample_rate: Option<String>,
    channels: Option<u32>,
    #[serde(default)]
    disposition: RawDisposition,
    #[serde(default)]
    side_data_list: Vec<RawSideData>,
    #[serde(default)]
    tags: std::collections::HashMap<String, String>,
}

#[derive(Deserialize, Default)]
struct RawDisposition {
    #[serde(default)]
    attached_pic: u8,
}

#[derive(Deserialize)]
struct RawSideData {
    rotation: Option<f64>,
}

fn parse_rate(s: Option<&str>) -> Option<f64> {
    let s = s?;
    let (n, d) = s.split_once('/').unwrap_or((s, "1"));
    let (n, d): (f64, f64) = (n.parse().ok()?, d.parse().ok()?);
    (n > 0.0 && d > 0.0).then(|| n / d)
}

fn seconds_to_us(s: Option<&str>) -> Option<u64> {
    let v: f64 = s?.parse().ok()?;
    (v.is_finite() && v > 0.0).then(|| (v * 1_000_000.0).round() as u64)
}

fn normalize_rotation(deg: f64) -> u32 {
    (((deg.round() as i64) % 360 + 360) % 360) as u32
}

/// Formatos que o ffprobe usa para arquivos de imagem estática.
fn is_still_image_format(format_name: &str) -> bool {
    format_name == "image2" || format_name.ends_with("_pipe")
}

pub fn interpret(json: &str) -> Result<MediaProbe, String> {
    let raw: RawProbe =
        serde_json::from_str(json).map_err(|e| format!("resposta inesperada do ffprobe: {e}"))?;
    let format = raw.format.ok_or("o ffprobe não reconheceu o formato do arquivo")?;

    // Capas de álbum (attached_pic) não contam como vídeo.
    let video = raw
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video") && s.disposition.attached_pic == 0);
    let audio = raw.streams.iter().find(|s| s.codec_type.as_deref() == Some("audio"));

    if video.is_none() && audio.is_none() {
        return Err("o arquivo não contém vídeo nem áudio".into());
    }

    let duration_us = seconds_to_us(format.duration.as_deref())
        .or_else(|| video.and_then(|v| seconds_to_us(v.duration.as_deref())))
        .or_else(|| audio.and_then(|a| seconds_to_us(a.duration.as_deref())));

    let kind = match (video, audio) {
        (Some(_), None) if is_still_image_format(&format.format_name) || duration_us.is_none() => {
            MediaKind::Image
        }
        (Some(_), _) => MediaKind::Video,
        (None, _) => MediaKind::Audio,
    };
    if kind != MediaKind::Image && duration_us.is_none() {
        return Err("não foi possível determinar a duração da mídia".into());
    }

    let rotation = video
        .map(|v| {
            v.side_data_list
                .iter()
                .find_map(|sd| sd.rotation)
                .or_else(|| v.tags.get("rotate").and_then(|r| r.parse().ok()))
                .map(normalize_rotation)
                .unwrap_or(0)
        })
        .unwrap_or(0);
    let (mut width, mut height) = (video.and_then(|v| v.width), video.and_then(|v| v.height));
    if rotation % 180 == 90 {
        std::mem::swap(&mut width, &mut height);
    }

    Ok(MediaProbe {
        kind,
        duration_us: if kind == MediaKind::Image { None } else { duration_us },
        width,
        height,
        fps: match kind {
            MediaKind::Video => video.and_then(|v| {
                parse_rate(v.avg_frame_rate.as_deref()).or_else(|| parse_rate(v.r_frame_rate.as_deref()))
            }),
            _ => None,
        },
        rotation,
        has_video: video.is_some(),
        has_audio: audio.is_some(),
        video_codec: video.and_then(|v| v.codec_name.clone()),
        audio_codec: audio.and_then(|a| a.codec_name.clone()),
        sample_rate: audio.and_then(|a| a.sample_rate.as_deref()?.parse().ok()),
        channels: audio.and_then(|a| a.channels),
        container: format.format_name,
    })
}

fn require_file(path: &Path) -> Result<(), String> {
    if path.is_file() {
        Ok(())
    } else {
        Err(format!("arquivo não encontrado: {}", path.display()))
    }
}

pub fn probe(path: &Path) -> Result<MediaProbe, String> {
    require_file(path)?;
    let ffprobe = ffmpeg::locate("ffprobe").ok_or("ffprobe não encontrado")?;
    let args: [&OsStr; 7] = [
        "-v".as_ref(),
        "error".as_ref(),
        "-print_format".as_ref(),
        "json".as_ref(),
        "-show_format".as_ref(),
        "-show_streams".as_ref(),
        path.as_os_str(),
    ];
    let out = ffmpeg::run_with_timeout(&ffprobe, &args, PROBE_TIMEOUT)?;
    interpret(&String::from_utf8_lossy(&out))
}

/// Gera uma miniatura JPEG (largura `THUMB_WIDTH`) do quadro em `at_us`.
/// O ffmpeg aplica a rotação de exibição automaticamente.
pub fn thumbnail(path: &Path, at_us: u64) -> Result<Vec<u8>, String> {
    require_file(path)?;
    let ffmpeg_bin = ffmpeg::locate("ffmpeg").ok_or("ffmpeg não encontrado")?;
    let seek = format!("{:.6}", at_us as f64 / 1_000_000.0);
    let scale = format!("scale={THUMB_WIDTH}:-2");
    let args: [&OsStr; 17] = [
        "-v".as_ref(),
        "error".as_ref(),
        "-ss".as_ref(),
        seek.as_ref(),
        "-i".as_ref(),
        path.as_os_str(),
        "-frames:v".as_ref(),
        "1".as_ref(),
        "-vf".as_ref(),
        scale.as_ref(),
        "-c:v".as_ref(),
        "mjpeg".as_ref(),
        "-q:v".as_ref(),
        "5".as_ref(),
        "-f".as_ref(),
        "image2pipe".as_ref(),
        "pipe:1".as_ref(),
    ];
    let jpeg = ffmpeg::run_with_timeout(&ffmpeg_bin, &args, THUMB_TIMEOUT)?;
    if !jpeg.starts_with(&[0xFF, 0xD8]) {
        return Err("o ffmpeg não gerou uma imagem (o instante pode estar além do fim)".into());
    }
    Ok(jpeg)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe_json(format: &str, duration: Option<&str>, streams: &str) -> String {
        let d = duration.map(|d| format!(",\"duration\":\"{d}\"")).unwrap_or_default();
        format!("{{\"streams\":[{streams}],\"format\":{{\"format_name\":\"{format}\"{d}}}}}")
    }

    const H264: &str = r#"{"codec_type":"video","codec_name":"h264","width":640,"height":360,"avg_frame_rate":"25/1","r_frame_rate":"25/1","duration":"3.000000","disposition":{"attached_pic":0}}"#;
    const AAC: &str = r#"{"codec_type":"audio","codec_name":"aac","sample_rate":"44100","channels":1,"duration":"3.000000"}"#;

    #[test]
    fn video_with_audio() {
        let p = interpret(&probe_json("mov,mp4,m4a,3gp,3g2,mj2", Some("3.000000"), &format!("{H264},{AAC}"))).unwrap();
        assert_eq!(p.kind, MediaKind::Video);
        assert_eq!(p.duration_us, Some(3_000_000));
        assert_eq!((p.width, p.height), (Some(640), Some(360)));
        assert_eq!(p.fps, Some(25.0));
        assert!(p.has_audio && p.has_video);
        assert_eq!(p.sample_rate, Some(44100));
    }

    #[test]
    fn audio_only() {
        let p = interpret(&probe_json("wav", Some("2.000000"), AAC)).unwrap();
        assert_eq!(p.kind, MediaKind::Audio);
        assert_eq!(p.duration_us, Some(2_000_000));
        assert_eq!(p.fps, None);
        assert!(!p.has_video);
    }

    #[test]
    fn still_image() {
        let png = r#"{"codec_type":"video","codec_name":"png","width":320,"height":240,"avg_frame_rate":"25/1"}"#;
        let p = interpret(&probe_json("png_pipe", None, png)).unwrap();
        assert_eq!(p.kind, MediaKind::Image);
        assert_eq!(p.duration_us, None);
        assert_eq!(p.fps, None);
    }

    #[test]
    fn audio_with_cover_art_is_audio() {
        let cover = r#"{"codec_type":"video","codec_name":"mjpeg","width":500,"height":500,"disposition":{"attached_pic":1}}"#;
        let p = interpret(&probe_json("mp3", Some("180.5"), &format!("{AAC},{cover}"))).unwrap();
        assert_eq!(p.kind, MediaKind::Audio);
        assert!(!p.has_video);
        assert_eq!(p.width, None);
    }

    #[test]
    fn rotation_swaps_dimensions() {
        let rotated = H264.replace(
            "\"disposition\"",
            "\"side_data_list\":[{\"side_data_type\":\"Display Matrix\",\"rotation\":-90}],\"disposition\"",
        );
        let p = interpret(&probe_json("mov,mp4", Some("3"), &rotated)).unwrap();
        assert_eq!(p.rotation, 270);
        assert_eq!((p.width, p.height), (Some(360), Some(640)));
    }

    #[test]
    fn rejects_files_without_media() {
        assert!(interpret(&probe_json("tty", Some("1"), "")).unwrap_err().contains("nem áudio"));
        assert!(interpret("{\"streams\":[]}").is_err());
        assert!(interpret("lixo").is_err());
    }

    #[test]
    fn rate_parsing() {
        assert_eq!(parse_rate(Some("30000/1001")).map(|r| (r * 1000.0).round()), Some(29970.0));
        assert_eq!(parse_rate(Some("0/0")), None);
        assert_eq!(parse_rate(None), None);
    }
}
