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
    /// Line index of the footer/status bar (if detected), 0-based
    pub footer_line: Option<usize>,
    /// Line index of the input/prompt area (if detected), 0-based
    pub input_line: Option<usize>,
    /// Display width per visible line in columns (top to bottom)
    pub lines: Vec<usize>,
    /// Leading whitespace offset per line in columns (where content starts)
    pub line_offsets: Vec<usize>,
    /// Simple hash per line for content-based coloring
    pub hashes: Vec<u32>,
    /// Direct pixel bounds of the prompt box (between the top and bottom
    /// box-drawing separators), relative to the window's top-left. Measured
    /// via `AXBoundsForRange` on macOS/iTerm so the overlay's PROMPT rect
    /// matches the real on-screen box instead of being derived from
    /// `input_line * line_height`, which drifts by fractions of a pixel
    /// and visually bleeds into the row below.
    pub prompt_rect: Option<(f64, f64, f64, f64)>,
    /// Direct pixel bounds of the footer/status strip. Same reasoning as
    /// `prompt_rect` — measure what iTerm actually renders rather than
    /// inferring from per-row arithmetic.
    pub footer_rect: Option<(f64, f64, f64, f64)>,
}

mod text_analysis;
pub use text_analysis::{default_dump_path, set_default_dump_enabled};

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
