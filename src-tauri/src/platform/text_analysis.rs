//! Text-content analysis helpers shared across platform backends.
//!
//! Every backend (macOS AX, Windows UI Automation, Linux AT-SPI) needs the
//! same logic for: locating Claude Code's prompt box (between two box-
//! drawing separators), classifying shell prompt lines for fallback,
//! identifying horizontal separators, and measuring CJK / emoji column
//! widths. Plus a shared `STICK_AROUND_DUMP_DETECTION` writer so all
//! three backends produce comparable diagnostic dumps. Keeping one
//! canonical implementation here means a fix in one place applies
//! everywhere.

use std::sync::atomic::{AtomicBool, Ordering};

/// Runtime toggle for the dump file. The V debug overlay flips this on
/// so a diagnostic snapshot lands in the temp dir without the user
/// having to set an env var. The env var still wins when set, so
/// custom paths keep working.
static DUMP_TO_DEFAULT: AtomicBool = AtomicBool::new(false);

pub fn set_default_dump_enabled(enabled: bool) {
    DUMP_TO_DEFAULT.store(enabled, Ordering::Relaxed);
}

/// Default dump path used when `set_default_dump_enabled(true)` has
/// fired and the env var is unset.
pub fn default_dump_path() -> std::path::PathBuf {
    std::env::temp_dir().join("stick-around-detection.dump")
}

/// Dump the detector's view of a poll cycle to a file. Writes when the
/// `STICK_AROUND_DUMP_DETECTION` env var is set (custom path) or when
/// the V debug overlay has called `set_default_dump_enabled(true)`
/// (default temp-dir path). Used to debug prompt / footer detection
/// across all backends.
///
/// Each call truncates and rewrites the file, so the latest snapshot
/// is always there — kill the overlay (`Q` or `pkill stick-around`) to
/// freeze it before inspecting. Box-drawing characters are preserved
/// verbatim; only ASCII control bytes are escaped.
pub fn dump_detection_snapshot(
    label: &str,
    text_lines: &[&str],
    input_line: Option<usize>,
    footer_line: Option<usize>,
    prompt_rect: Option<(f64, f64, f64, f64)>,
    footer_rect: Option<(f64, f64, f64, f64)>,
    extras: &[(&str, String)],
) {
    let path: std::path::PathBuf = match std::env::var("STICK_AROUND_DUMP_DETECTION") {
        Ok(p) if !p.is_empty() => p.into(),
        _ => {
            if !DUMP_TO_DEFAULT.load(Ordering::Relaxed) {
                return;
            }
            default_dump_path()
        }
    };
    use std::fmt::Write as _;
    let mut out = String::new();
    let _ = writeln!(out, "=== stick-around prompt detection dump ===");
    let _ = writeln!(out, "backend     : {label}");
    let _ = writeln!(out, "input_line  : {:?}", input_line);
    let _ = writeln!(out, "footer_line : {:?}", footer_line);
    let _ = writeln!(out, "prompt_rect : {:?}", prompt_rect);
    let _ = writeln!(out, "footer_rect : {:?}", footer_rect);
    for (k, v) in extras {
        let _ = writeln!(out, "{k:<12}: {v}");
    }
    let _ = writeln!(out, "--- text_lines ({}) ---", text_lines.len());
    for (i, l) in text_lines.iter().enumerate() {
        let marker = if Some(i) == input_line {
            "INPUT"
        } else if Some(i) == footer_line {
            "FOOT "
        } else {
            "     "
        };
        let rendered: String = l
            .chars()
            .map(|c| {
                if c == '\t' {
                    "\\t".to_string()
                } else if (c as u32) < 0x20 || c as u32 == 0x7F {
                    format!("\\x{:02X}", c as u32)
                } else {
                    c.to_string()
                }
            })
            .collect();
        let _ = writeln!(out, "[{i:3}] {marker} |{rendered}|");
    }
    let _ = std::fs::write(&path, out);
}

/// Locate the prompt box and footer line in a screen of terminal text.
///
/// Returns `(input_line, footer_line)` where:
/// * `input_line` is the index of the prompt box's *top* separator
/// * `footer_line` is the index of the line immediately below the box bottom
///
/// Strategy: collect every separator line, then walk pairs from the bottom up
/// looking for two separators close enough to plausibly frame a single prompt
/// box. If no pair fits, fall back to detecting a plain shell prompt line.
pub fn detect_terminal_regions(text_lines: &[&str]) -> (Option<usize>, Option<usize>) {
    let len = text_lines.len();
    if len == 0 {
        return (None, None);
    }

    // Collect every separator line in the visible content. Claude Code has
    // exactly one prompt box, but tool output / markdown rules can add more
    // separators above it, so we scan the whole frame and then pick the
    // bottom-most valid pair.
    let mut separators: Vec<usize> = Vec::new();
    for i in 0..len {
        if is_separator_line(text_lines[i].trim()) {
            separators.push(i);
        }
    }

    // Maximum plausible gap between the top and bottom borders of the prompt
    // box. Claude Code's box is 1 prompt line; tool boxes can be larger but
    // we still want to tolerate a multi-line input buffer.
    const MAX_PROMPT_GAP: usize = 12;

    // Walk separators from the bottom up looking for a pair (top, bottom)
    // where `top < bottom` and they are close enough to plausibly frame a
    // prompt box. The first such pair is the lowest on screen.
    for b in (0..separators.len()).rev() {
        let bottom = separators[b];
        for t in (0..b).rev() {
            let top = separators[t];
            let gap = bottom - top;
            if gap >= 2 && gap <= MAX_PROMPT_GAP {
                let footer = if bottom + 1 < len { Some(bottom + 1) } else { None };
                return (Some(top), footer);
            }
        }
    }

    // No valid separator pair found. If there are no separators at all, try
    // the shell prompt-character fallback (for plain bash/zsh, not Claude
    // Code). Otherwise return (None, None) and let the frontend keep using
    // the cached last-known position — a lone or far-apart separator is
    // almost always a markdown rule or a scrolled-off tool box, and treating
    // it as the prompt top would render a huge, obviously-wrong footer rect
    // covering the lower half of the terminal.
    if separators.is_empty() {
        for i in (0..len).rev() {
            let trimmed = text_lines[i].trim();
            if trimmed.is_empty() {
                continue;
            }
            if is_prompt_line(trimmed) {
                return (Some(i), None);
            }
        }
    }
    (None, None)
}

/// Check if a trimmed line looks like a shell prompt.
pub fn is_prompt_line(trimmed: &str) -> bool {
    // Common prompt indicators (checked at start of trimmed line)
    const PROMPT_CHARS: &[char] = &[
        '\u{276F}', // ❯ — starship, some zsh themes
        '\u{279C}', // ➜ — oh-my-zsh robbyrussell
        '\u{03BB}', // λ — lambda prompts
        '\u{2192}', // → — arrow prompts
    ];

    // Check Unicode prompt characters
    if let Some(first) = trimmed.chars().next() {
        if PROMPT_CHARS.contains(&first) {
            return true;
        }
    }

    // Check common ASCII prompt endings: "$ ", "% ", "> ", "# "
    // These need context — a lone $ or % at the start suggests a prompt.
    // We look for patterns like "user@host:path$ " or just "$ "
    let bytes = trimmed.as_bytes();
    let last_meaningful = trimmed.trim_end();
    if let Some(last) = last_meaningful.chars().last() {
        if matches!(last, '$' | '%' | '#' | '>') {
            // Single prompt char or ends with prompt char after a path/user string
            let non_prompt: &str = &last_meaningful[..last_meaningful.len() - last.len_utf8()];
            let non_prompt = non_prompt.trim_end();
            // Accept if the line is just the prompt char, or has typical prompt prefix
            if non_prompt.is_empty()
                || non_prompt.ends_with(':')
                || non_prompt.ends_with(')')
                || non_prompt.contains('@')
            {
                return true;
            }
        }
    }

    // "PS1"-style: line starts with [ and contains ] followed by prompt char
    if bytes.first() == Some(&b'[') && trimmed.contains(']') {
        if let Some(after_bracket) = trimmed.rsplit(']').next() {
            let after = after_bracket.trim();
            if after.is_empty()
                || after == "$"
                || after == "%"
                || after == "#"
                || after == ">"
            {
                return true;
            }
        }
    }

    false
}

/// Check if a line is a separator/border (horizontal rules, box-drawing).
pub fn is_separator_line(trimmed: &str) -> bool {
    if trimmed.is_empty() {
        return false;
    }
    // A separator is a line made mostly of repeating border/rule characters
    let total = trimmed.chars().count();
    if total < 3 {
        return false;
    }
    let border_count = trimmed.chars().filter(|c| {
        matches!(*c,
            '\u{2500}'..='\u{257F}' // Box Drawing (includes ─ ━ │ ┃ corners etc.)
            | '\u{2580}'..='\u{259F}' // Block Elements (▀ ▄ █ etc.)
            | '-' | '=' | '_'
            | '\u{23AF}' // Horizontal line extension
            | '\u{2015}' // Horizontal bar
            | '\u{2014}' // Em dash
            | '\u{2013}' // En dash
        )
    }).count();
    // At least 60% border characters (allow corners, spaces, decorative elements)
    border_count * 5 >= total * 3
}

/// Approximate check for wide (2-column) characters in a terminal.
pub fn is_wide_char(c: char) -> bool {
    let cp = c as u32;
    // CJK Unified Ideographs, CJK Compatibility Ideographs, etc.
    matches!(cp,
        0x1100..=0x115F   // Hangul Jamo
        | 0x2E80..=0x303E // CJK Radicals, Kangxi, Ideographic Description
        | 0x3040..=0x33BF // Hiragana, Katakana, Bopomofo, CJK Compatibility
        | 0x3400..=0x4DBF // CJK Extension A
        | 0x4E00..=0x9FFF // CJK Unified Ideographs
        | 0xA000..=0xA4CF // Yi
        | 0xAC00..=0xD7AF // Hangul Syllables
        | 0xF900..=0xFAFF // CJK Compatibility Ideographs
        | 0xFE10..=0xFE6F // Vertical forms, CJK Compatibility Forms
        | 0xFF01..=0xFF60 // Fullwidth Forms
        | 0xFFE0..=0xFFE6 // Fullwidth Signs
        | 0x1F000..=0x1FBFF // Mahjong, Dominos, Playing Cards, Emoticons, Misc Symbols
        | 0x20000..=0x2FFFF // CJK Extension B-F
        | 0x30000..=0x3FFFF // CJK Extension G-H
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_bottom_prompt_box_when_multiple_separator_pairs_present() {
        // Tool output box followed by the real prompt box.
        let lines = vec![
            "some history",
            "╭──── tool output ────╮",
            "│ tool line 1         │",
            "│ tool line 2         │",
            "╰─────────────────────╯",
            "more history",
            "╭─────────────────────╮", // real prompt top (idx 6)
            "│ >                   │",
            "╰─────────────────────╯", // real prompt bottom (idx 8)
            "  ? for shortcuts",       // footer (idx 9)
        ];
        let (input, footer) = detect_terminal_regions(&lines);
        assert_eq!(input, Some(6), "input_line should be the lower prompt box top");
        assert_eq!(footer, Some(9), "footer should be the line after the lower box");
    }

    #[test]
    fn picks_single_prompt_box() {
        let lines = vec![
            "history line",
            "╭─────╮",
            "│ >   │",
            "╰─────╯",
            "footer",
        ];
        let (input, footer) = detect_terminal_regions(&lines);
        assert_eq!(input, Some(1));
        assert_eq!(footer, Some(4));
    }

    #[test]
    fn ignores_far_apart_separators_that_cannot_be_one_box() {
        // A single stray separator far above a real prompt box must not pair.
        let mut lines = vec!["───────"]; // stray at idx 0
        for _ in 0..20 {
            lines.push("content");
        }
        lines.push("╭─────╮"); // idx 21
        lines.push("│ >   │");
        lines.push("╰─────╯"); // idx 23
        lines.push("footer");
        let (input, footer) = detect_terminal_regions(&lines);
        assert_eq!(input, Some(21));
        assert_eq!(footer, Some(24));
    }

    #[test]
    fn returns_none_for_empty_input() {
        let lines: Vec<&str> = vec![];
        let (input, footer) = detect_terminal_regions(&lines);
        assert_eq!(input, None);
        assert_eq!(footer, None);
    }

    #[test]
    fn returns_none_when_only_a_stray_separator_is_visible() {
        // Claude Code "processing" state — no prompt box visible, just a lone
        // separator from a tool output bottom. Must not be treated as prompt
        // top, since that would produce a huge false footer rect.
        let mut lines = vec![];
        for _ in 0..10 {
            lines.push("history content");
        }
        lines.push("╰─ end of tool ─╯"); // idx 10 (lone separator)
        for _ in 0..15 {
            lines.push("status text");
        }
        let (input, footer) = detect_terminal_regions(&lines);
        assert_eq!(input, None);
        assert_eq!(footer, None);
    }

    #[test]
    fn returns_none_when_separators_are_too_far_apart() {
        // Two stray separators far apart (e.g. markdown rule + tool bottom)
        // must not be fused into one huge prompt box.
        let mut lines = vec!["───────"]; // stray at idx 0
        for _ in 0..25 {
            lines.push("content");
        }
        lines.push("╰─────╯"); // idx 26 — also stray
        lines.push("more text");
        let (input, footer) = detect_terminal_regions(&lines);
        assert_eq!(input, None);
        assert_eq!(footer, None);
    }
}
