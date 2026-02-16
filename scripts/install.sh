#!/usr/bin/env bash
# Install Claude Status for Stream Deck — hooks + iTerm2 daemon
# Usage: npm run setup  (or: bash scripts/install.sh)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

HOOK_SRC="$REPO_DIR/hooks/sd-notify.sh"
HOOK_DST="$HOME/.claude/hooks/sd-notify.sh"

DAEMON_SRC="$REPO_DIR/iterm2/claude-status.py"
DAEMON_DST="$HOME/Library/Application Support/iTerm2/Scripts/AutoLaunch/claude-status.py"

SETTINGS="$HOME/.claude/settings.json"

HOOK_CMD="~/.claude/hooks/sd-notify.sh"

# --- Colors ---
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }

# --- Prerequisite check ---
if ! command -v jq &>/dev/null; then
  red "Error: jq is required. Install with: brew install jq"
  exit 1
fi

echo "=== Claude Status for Stream Deck — Setup ==="
echo

# --- 1. Hook script ---
echo "1) Installing hook script..."
mkdir -p "$(dirname "$HOOK_DST")"
cp "$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_DST"
green "   → $HOOK_DST"

# --- 2. Claude settings.json (merge hooks) ---
echo "2) Configuring hooks in settings.json..."
mkdir -p "$(dirname "$SETTINGS")"
if [[ ! -f "$SETTINGS" ]]; then
  echo '{}' > "$SETTINGS"
fi

# Merge hook entries using jq (new matcher format).
# Removes any existing sd-notify entry first to avoid duplicates.
TMP="$(mktemp)"
jq --arg cmd "$HOOK_CMD" '
  # New hook format: each event has array of {matcher?, hooks: [{type, command, async?}]}
  def our_entry:
    {"hooks": [{"type": "command", "command": $cmd, "async": true}]};
  def is_ours:
    has("hooks") and (.hooks | any(.command == $cmd));
  def ensure_hook($event):
    .hooks[$event] = (
      (.hooks[$event] // [])
      | [.[] | select(is_ours | not)]
      | . + [our_entry]
    );
  ensure_hook("SessionStart")
  | ensure_hook("UserPromptSubmit")
  | ensure_hook("PreToolUse")
  | ensure_hook("Notification")
  | ensure_hook("PreCompact")
  | ensure_hook("Stop")
  | ensure_hook("SessionEnd")
' "$SETTINGS" > "$TMP" && mv "$TMP" "$SETTINGS"
green "   → $SETTINGS (7 hook events)"

# --- 3. iTerm2 Python daemon ---
echo "3) Installing iTerm2 Python daemon..."
mkdir -p "$(dirname "$DAEMON_DST")"
cp "$DAEMON_SRC" "$DAEMON_DST"
green "   → $DAEMON_DST"

# --- Done ---
echo
green "Setup complete!"
echo
echo "Next steps:"
echo "  1. Enable iTerm2 Python API:"
echo "     iTerm2 > Settings > General > Magic > Enable Python API"
echo "  2. Restart iTerm2 (the daemon auto-launches on startup)"
echo "  3. Build & install the Stream Deck plugin:"
echo "     npm run build"
echo "     streamdeck link com.keiya.claude-status.sdPlugin"
echo "  4. Open Stream Deck app and add Claude Session actions"
echo "  5. Launch 'claude' in any iTerm2 tab — it just works!"
