pub mod export;
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

/// Autoriza o WebView a ler estes arquivos pelo protocolo `asset` (pré-visualização).
/// O escopo começa vazio; só arquivos de mídia existentes do projeto entram.
#[tauri::command]
fn allow_media_files<R: tauri::Runtime>(app: tauri::AppHandle<R>, paths: Vec<PathBuf>) -> Result<(), String> {
    use tauri::Manager;
    let scope = app.asset_protocol_scope();
    for p in paths.iter().filter(|p| p.is_file()) {
        scope.allow_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Gera (ou reaproveita) o proxy de pré-visualização e já o autoriza no escopo.
#[tauri::command]
async fn ensure_proxy<R: tauri::Runtime>(app: tauri::AppHandle<R>, path: PathBuf) -> Result<PathBuf, String> {
    use tauri::Manager;
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("proxies");
    let proxy = tauri::async_runtime::spawn_blocking(move || media::ensure_proxy(&path, &cache))
        .await
        .map_err(|e| format!("falha interna: {e}"))??;
    app.asset_protocol_scope().allow_file(&proxy).map_err(|e| e.to_string())?;
    Ok(proxy)
}

/// Exportações em andamento: id → sinal de cancelamento.
#[derive(Default)]
struct ExportJobs(std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportProgressEvent {
    job_id: String,
    #[serde(flatten)]
    progress: export::Progress,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportDoneEvent {
    job_id: String,
    ok: bool,
    cancelled: bool,
    error: Option<String>,
    output_path: String,
}

/// Encoders H.264 que funcionam nesta máquina (testados uma vez por execução).
#[tauri::command]
async fn export_encoders() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(export::working_h264_encoders).await.unwrap_or_default()
}

/// Inicia a exportação em segundo plano; o andamento chega pelos eventos
/// `export-progress` e `export-done`.
#[tauri::command]
fn export_start<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    jobs: tauri::State<'_, ExportJobs>,
    job_id: String,
    args: Vec<String>,
    output_path: PathBuf,
) -> Result<(), String> {
    use tauri::Emitter;
    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    jobs.0.lock().unwrap().insert(job_id.clone(), std::sync::Arc::clone(&cancel));
    std::thread::spawn(move || {
        let app2 = app.clone();
        let id = job_id.clone();
        let result = export::run_export(&args, &output_path, cancel, |progress| {
            let _ = app2.emit("export-progress", ExportProgressEvent { job_id: id.clone(), progress });
        });
        use tauri::Manager;
        app.state::<ExportJobs>().0.lock().unwrap().remove(&job_id);
        let (ok, cancelled, error) = match result {
            Ok(()) => (true, false, None),
            Err(export::ExportError::Cancelled) => (false, true, None),
            Err(export::ExportError::Failed(e)) => (false, false, Some(e)),
        };
        let _ = app.emit(
            "export-done",
            ExportDoneEvent { job_id, ok, cancelled, error, output_path: output_path.to_string_lossy().into_owned() },
        );
    });
    Ok(())
}

#[tauri::command]
fn export_cancel(jobs: tauri::State<'_, ExportJobs>, job_id: String) {
    if let Some(flag) = jobs.0.lock().unwrap().get(&job_id) {
        flag.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Abre o Explorer com o arquivo selecionado.
#[tauri::command]
fn reveal_in_explorer(path: PathBuf) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("{} não existe", path.display()));
    }
    let mut arg = std::ffi::OsString::from("/select,");
    arg.push(path.as_os_str());
    std::process::Command::new("explorer.exe").arg(arg).spawn().map(|_| ()).map_err(|e| e.to_string())
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
        startup_project_path,
        allow_media_files,
        ensure_proxy,
        export_encoders,
        export_start,
        export_cancel,
        reveal_in_explorer
    ])
    .manage(ExportJobs::default())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    with_commands(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // FFmpeg distribuído com o instalador (pasta de recursos `ffmpeg/`).
            use tauri::Manager;
            if let Ok(dir) = app.path().resource_dir() {
                ffmpeg::set_bundled_dir(dir.join("ffmpeg"));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
