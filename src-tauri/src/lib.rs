// The analysis runs in the web layer (pose model + TypeScript core), so the same code
// serves desktop, mobile and web. The native side only provides windows and file saving.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running Courtside");
}
