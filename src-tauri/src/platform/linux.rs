use std::process::Command;

fn run_cmd(program: &str, args: &[&str]) -> Option<String> {
    Command::new(program)
        .args(args)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

fn get_window_geometry(wid: &str) -> Option<(i32, i32, u32, u32)> {
    let output = run_cmd("xdotool", &["getwindowgeometry", "--shell", wid])?;
    let mut x = 0i32;
    let mut y = 0i32;
    let mut w = 0u32;
    let mut h = 0u32;
    for line in output.lines() {
        if let Some(val) = line.strip_prefix("X=") {
            x = val.parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("Y=") {
            y = val.parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("WIDTH=") {
            w = val.parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("HEIGHT=") {
            h = val.parse().unwrap_or(0);
        }
    }
    if w > 0 && h > 0 {
        Some((x, y, w, h))
    } else {
        None
    }
}

pub fn get_all_window_bounds(pid: u32) -> Vec<(i32, i32, u32, u32)> {
    let output = match run_cmd("xdotool", &["search", "--pid", &pid.to_string()]) {
        Some(o) => o,
        None => return vec![],
    };
    output
        .lines()
        .filter_map(|wid| get_window_geometry(wid.trim()))
        .collect()
}

pub fn get_front_window_bounds(pid: u32) -> Option<(i32, i32, u32, u32)> {
    let active = run_cmd("xdotool", &["getactivewindow"])?;
    let active_pid = run_cmd("xdotool", &["getwindowpid", active.trim()])?;
    if active_pid.trim().parse::<u32>().ok() == Some(pid) {
        return get_window_geometry(active.trim());
    }
    // Fallback: first window of the PID
    get_all_window_bounds(pid).into_iter().next()
}

pub fn get_frontmost_pid() -> Option<u32> {
    let wid = run_cmd("xdotool", &["getactivewindow"])?;
    let pid_str = run_cmd("xdotool", &["getwindowpid", wid.trim()])?;
    pid_str.trim().parse().ok()
}

pub fn raise_window_at(pid: u32, x: i32, y: i32) {
    let output = match run_cmd("xdotool", &["search", "--pid", &pid.to_string()]) {
        Some(o) => o,
        None => return,
    };
    for wid in output.lines() {
        let wid = wid.trim();
        if let Some((wx, wy, _, _)) = get_window_geometry(wid) {
            if wx == x && wy == y {
                let _ = Command::new("xdotool")
                    .args(["windowactivate", wid])
                    .output();
                return;
            }
        }
    }
    // Fallback: activate the first window of the PID
    if let Some(wid) = output.lines().next() {
        let _ = Command::new("xdotool")
            .args(["windowactivate", wid.trim()])
            .output();
    }
}

pub fn get_terminal_content(
    _pid: u32,
    _target_xy: Option<(i32, i32)>,
) -> Option<super::TerminalContent> {
    // TODO: implement terminal text reading for Linux
    None
}

pub fn get_pid_by_name(name: &str) -> Option<u32> {
    let output = run_cmd("pgrep", &["-x", name])?;
    output.lines().next()?.trim().parse().ok()
}
