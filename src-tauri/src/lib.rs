pub mod cache;
pub mod commands;
pub mod models;
pub mod scanner;

use commands::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::scan,
            commands::cancel_scan,
            commands::regroup,
            commands::get_duplicate_groups,
            commands::get_folder_priorities,
            commands::set_folder_priorities,
            commands::auto_mark_group,
            commands::delete_marked,
            commands::clear_cache,
            commands::check_ffmpeg,
            commands::set_scan_priority,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
