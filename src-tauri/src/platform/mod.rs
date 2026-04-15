/// Terminal content info: text area geometry + visible line data.
#[derive(Clone, serde::Serialize, PartialEq)]
pub struct TerminalContent {
    /// Offset of the text area from the top of the window (pixels)
    pub text_offset_y: f64,
    /// Offset of the text area from the left of the window (pixels)
    pub text_offset_x: f64,
    /// Height of the visible text area (pixels)
    pub text_height: f64,
    /// Width of the visible text area (pixels)
    pub text_width: f64,
    /// Terminal column count (characters per row)
    pub term_cols: usize,
    /// Terminal row count (visible rows)
    pub term_rows: usize,
    /// Line index of the input area border (if detected), 0-based
    pub input_line: Option<usize>,
    /// Display width per visible line in columns (top to bottom)
    pub lines: Vec<usize>,
    /// Simple hash per line for content-based coloring
    pub hashes: Vec<u32>,
}

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;
