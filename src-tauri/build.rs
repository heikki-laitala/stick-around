use std::process::Command;

fn main() {
    let date = Command::new("date")
        .arg("+%Y.%m.%d")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=STICK_VERSION=v{}", date);

    tauri_build::build();
}
