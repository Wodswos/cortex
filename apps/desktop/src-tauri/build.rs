fn main() {
    println!("cargo:rerun-if-env-changed=CORTEX_DESKTOP_API_ORIGIN");
    tauri_build::build()
}
