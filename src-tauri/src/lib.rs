mod ffmpeg;

/// Diagnóstico do FFmpeg; roda fora da thread principal porque executa processos.
#[tauri::command]
async fn ffmpeg_status() -> ffmpeg::FfmpegStatus {
    tauri::async_runtime::spawn_blocking(ffmpeg::status)
        .await
        .unwrap_or_else(|e| ffmpeg::FfmpegStatus::missing(format!("falha interna: {e}")))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ffmpeg_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
