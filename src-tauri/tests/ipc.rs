//! Exercita os comandos pelo mesmo caminho do frontend: `invoke(nome, {args})`
//! com corpo JSON, incluindo a conversão dos nomes de argumentos.

use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;

fn invoke(
    webview: &tauri::WebviewWindow<MockRuntime>,
    cmd: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, serde_json::Value> {
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize::<serde_json::Value>().unwrap())
}

#[test]
fn save_and_load_project_through_ipc() {
    let app = novacut_lib::with_commands(mock_builder())
        .build(mock_context(noop_assets()))
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("Projeto IPC.ncproj");
    let contents = "{\"format\":\"novacut-project\",\"name\":\"Ação\"}\n";

    let saved = invoke(&webview, "save_project", serde_json::json!({ "path": path, "contents": contents }));
    assert_eq!(saved, Ok(serde_json::Value::Null));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), contents);

    let loaded = invoke(&webview, "load_project", serde_json::json!({ "path": path }));
    assert_eq!(loaded, Ok(serde_json::Value::String(contents.into())));

    let wrong = invoke(&webview, "load_project", serde_json::json!({ "path": dir.path().join("x.txt") }));
    assert!(wrong.unwrap_err().as_str().unwrap().contains(".ncproj"));
}
