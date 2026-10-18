pub mod ffmpeg;
pub mod media;
mod project;

use std::path::PathBuf;

/// Diagnóstico do FFmpeg; roda fora da thread principal porque executa processos.
#[tauri::command]
async fn ffmpeg_status() -> ffmpeg::FfmpegStatus {
    tauri::async_runtime::spawn_blocking(ffmpeg::status)
        .await
        .unwrap_or_else(|e| ffmpeg::FfmpegStatus::missing(format!("falha interna: {e}")))
}

#[tauri::command]
async fn save_project(path: PathBuf, contents: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || project::save(&path, &contents))
        .await
        .map_err(|e| format!("falha interna: {e}"))?
}

#[tauri::command]
async fn load_project(path: PathBuf) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || project::load(&path))
        .await
        .map_err(|e| format!("falha interna: {e}"))?
}

#[tauri::command]
async fn probe_media(path: PathBuf) -> Result<media::MediaProbe, String> {
    tauri::async_runtime::spawn_blocking(move || media::probe(&path))
        .await
        .map_err(|e| format!("falha interna: {e}"))?
}

/// Devolve os bytes JPEG crus (ArrayBuffer no frontend), sem passar por JSON.
#[tauri::command]
async fn media_thumbnail(path: PathBuf, at_us: u64) -> Result<tauri::ipc::Response, String> {
    let jpeg = tauri::async_runtime::spawn_blocking(move || media::thumbnail(&path, at_us))
        .await
        .map_err(|e| format!("falha interna: {e}"))??;
    Ok(tauri::ipc::Response::new(jpeg))
}

/// Projeto passado na linha de comando (`novacut.exe projeto.ncproj`), se houver.
#[tauri::command]
fn startup_project_path() -> Option<PathBuf> {
    project::startup_path(std::env::args_os().skip(1))
}

/// Registra os comandos do NovaCut; compartilhado entre o app e os testes de IPC
/// (tests/ipc.rs).
pub fn with_commands<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        ffmpeg_status,
        save_project,
        load_project,
        probe_media,
        media_thumbnail,
        startup_project_path
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    with_commands(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
