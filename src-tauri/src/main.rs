#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let terminal_app = std::env::var("STICK_TERMINAL_APP").ok();
    stick_around::run(terminal_app)
}
