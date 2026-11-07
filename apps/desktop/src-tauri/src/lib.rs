mod desktop_api;

pub fn run() {
    let desktop_api = desktop_api::DesktopApi::new().expect("cannot initialize desktop API");
    let desktop_init = desktop_api.initialization_script();
    tauri::Builder::default()
        .manage(desktop_api)
        .invoke_handler(tauri::generate_handler![desktop_api::desktop_api_request])
        .plugin(
            tauri::plugin::Builder::<_, ()>::new("cortex-desktop-api")
                .js_init_script(desktop_init)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            use tauri::Manager;
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

            let win = app.get_webview_window("main").expect("main window");
            // ⌥Space 呼出 Quick Capture:聚焦窗口并向页面发事件(web 侧监听 cortex:quick-capture)
            let w = win.clone();
            app.global_shortcut().on_shortcut(
                "Alt+Space",
                move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = w.show();
                        let _ = w.set_focus();
                        let _ = w.eval("window.dispatchEvent(new CustomEvent('cortex:quick-capture'))");
                    }
                },
            )?;

            // 菜单栏 tooltip
            win.set_title("Cortex").ok();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running cortex");
}
