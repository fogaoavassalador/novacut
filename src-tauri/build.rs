fn main() {
    // O tauri-build só embute o manifesto do Windows no executável do app.
    // Testes de integração que criam janelas (tauri::test) precisam do
    // Common Controls v6; sem ele o binário falha ao iniciar (0xC0000139).
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
    tauri_build::build()
}
