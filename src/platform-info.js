// Runtime platform detection for the WebView. Used to gate the
// Linux-specific workarounds (canvas-clear bug, splash auto-dismiss
// timer, focus/input quirks under XWayland) without affecting macOS
// or Windows behavior.
export const IS_LINUX = typeof navigator !== 'undefined'
  && /Linux/i.test(navigator.platform || navigator.userAgent || '');
