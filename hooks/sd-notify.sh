#!/usr/bin/env bash
# Stream Deck Claude Status notifier
# Called by Claude Code hooks to update session state on Stream Deck.
#
# Binding priority:
#   1. ITERM_SESSION_ID → sends session_id (UUID part) — resolved by plugin via daemon mapping
#   2. SD_SLOT → sends slot directly (legacy fallback, no daemon needed)
#   3. Neither set → exit silently
#
# NOTE: Projects with "disableAllHooks": true in .claude/settings.local.json
# will NOT run this hook. Remove that setting to enable Stream Deck updates.

set -euo pipefail

SD_URL="http://127.0.0.1:51820/state"
INPUT=$(cat)
# Event name comes via stdin JSON, not environment variable
HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null || true)
# cwd is a common field in all hook events — always send as project
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)

# Determine binding: session_id or slot
SESSION_UUID=""
SLOT_NUM=""
FALLBACK_SLOT=""

if [[ -n "${ITERM_SESSION_ID:-}" ]]; then
  # Extract UUID portion after the colon (e.g. "w0t0p0:UUID" → "UUID")
  SESSION_UUID="${ITERM_SESSION_ID##*:}"
  # Extract tab index from prefix as fallback slot (e.g. "w0t2p0:UUID" → 3)
  # This is the tab index at session creation — correct unless tabs are reordered
  if [[ "$ITERM_SESSION_ID" =~ t([0-9]+) ]]; then
    FALLBACK_SLOT=$(( ${BASH_REMATCH[1]} + 1 ))
  fi
elif [[ -n "${SD_SLOT:-}" ]]; then
  SLOT_NUM="${SD_SLOT}"
else
  exit 0
fi

build_payload() {
  local state="$1"
  shift
  # Base payload with either session_id or slot
  local payload
  if [[ -n "$SESSION_UUID" ]]; then
    payload=$(jq -n --arg sid "$SESSION_UUID" --arg state "$state" '{session_id: $sid, state: $state}')
    # Add fallback_slot derived from tab index in ITERM_SESSION_ID
    if [[ -n "$FALLBACK_SLOT" ]] && [[ "$FALLBACK_SLOT" -ge 1 ]] && [[ "$FALLBACK_SLOT" -le 8 ]]; then
      payload=$(echo "$payload" | jq --argjson fs "$FALLBACK_SLOT" '. + {fallback_slot: $fs}')
    fi
  else
    payload=$(jq -n --argjson slot "${SLOT_NUM}" --arg state "$state" '{slot: $slot, state: $state}')
  fi

  if [[ -n "$CWD" ]]; then
    payload=$(echo "$payload" | jq --arg v "$CWD" '. + {project: $v}')
  fi

  # Add optional fields
  while [[ $# -gt 0 ]]; do
    local key="$1"
    local value="$2"
    shift 2
    if [[ -n "$value" ]]; then
      payload=$(echo "$payload" | jq --arg k "$key" --arg v "$value" '. + {($k): $v}')
    fi
  done

  echo "$payload"
}

case "$HOOK_EVENT" in
  SessionStart)
    payload=$(build_payload "idle")
    ;;

  UserPromptSubmit)
    prompt=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null | head -c 400 || true)
    payload=$(build_payload "thinking" "prompt" "$prompt")
    ;;

  PreToolUse)
    tool=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)
    payload=$(build_payload "thinking" "detail" "$tool")
    ;;

  Notification)
    ntype=$(echo "$INPUT" | jq -r '.notification_type // .type // empty' 2>/dev/null || true)
    case "$ntype" in
      permission_prompt)
        payload=$(build_payload "permission")
        ;;
      idle_prompt)
        payload=$(build_payload "idle")
        ;;
      *)
        exit 0
        ;;
    esac
    ;;

  PreCompact)
    payload=$(build_payload "compacting")
    ;;

  Stop)
    payload=$(build_payload "done")
    ;;

  SessionEnd)
    payload=$(build_payload "offline")
    ;;

  *)
    exit 0
    ;;
esac

# Post to plugin, never block Claude
curl --max-time 2 --silent --show-error \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "$SD_URL" >/dev/null 2>&1 || true

exit 0
