mod db;

/// Writes raw bytes to an absolute path chosen by the user via the save dialog.
/// Used by the export feature so files can be saved anywhere, not just Downloads.
#[tauri::command]
fn write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
  std::fs::write(&path, &contents).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();

  // The updater and process (relaunch) plugins are desktop-only; mobile apps
  // update through their respective app stores.
  #[cfg(desktop)]
  let builder = builder
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init());

  builder
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(db::builder().build())
    .invoke_handler(tauri::generate_handler![write_file])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
