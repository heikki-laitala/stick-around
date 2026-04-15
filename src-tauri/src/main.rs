#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let terminal_app = std::env::var("STICK_TERMINAL_APP").ok();
    eprintln!("[main] STICK_TERMINAL_APP={:?}", terminal_app);
    stick_around_overlay::run(terminal_app)
}
