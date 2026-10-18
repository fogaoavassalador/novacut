mod ffmpeg;
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

/// Registra os comandos do NovaCut; compartilhado entre o app e os testes de IPC
/// (tests/ipc.rs).
pub fn with_commands<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![ffmpeg_status, save_project, load_project])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    with_commands(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
