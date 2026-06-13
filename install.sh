#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${HOME}/.local/bin"
SCRIPT_URL="https://raw.githubusercontent.com/Metatronwings/claude-code-zenmux-status/main/zenmux-status.sh"
SCRIPT_PATH="${INSTALL_DIR}/zenmux-status.sh"

echo "=== Zenmux Status Installer ==="
echo ""

# Create install dir
mkdir -p "$INSTALL_DIR"

# Download script
echo "Downloading zenmux-status.sh ..."
curl -fsSL -o "$SCRIPT_PATH" "$SCRIPT_URL"
chmod +x "$SCRIPT_PATH"
echo "Installed to $SCRIPT_PATH"
echo ""

# Prompt for API key
echo -n "Enter your Zenmux Management API Key: "
read -r API_KEY </dev/tty
echo ""

if [[ -z "$API_KEY" ]]; then
  echo "No API key provided. You can set ZENMUX_MANAGEMENT_API_KEY later."
  exit 0
fi

# Prompt for progress bar
echo -n "Enable progress bar mode? [y/N]: "
read -r BAR_REPLY </dev/tty
echo ""

BAR_VAR=""
[[ "$BAR_REPLY" =~ ^[Yy]$ ]] && BAR_VAR="ZENMUX_PROGRESS_BAR=1 "

# Store API key in Claude Code settings (NOT in shell rc — those are world-readable).
# The statusLine command passes env vars inline so they never touch the shell profile.
SETTINGS_FILE="${PWD}/.claude/settings.local.json"
if [[ -f "$SETTINGS_FILE" ]]; then
  echo "Found $SETTINGS_FILE, updating statusLine..."
  if command -v jq &>/dev/null; then
    tmp=$(mktemp)
    jq --arg cmd "${BAR_VAR}ZENMUX_MANAGEMENT_API_KEY=${API_KEY} ${SCRIPT_PATH}" \
      '.statusLine = {"type":"command","command":$cmd}' \
      "$SETTINGS_FILE" > "$tmp" && mv "$tmp" "$SETTINGS_FILE"
    echo "Updated $SETTINGS_FILE"
  else
    echo "jq not found, cannot auto-update $SETTINGS_FILE"
    echo "Please manually update your statusLine command:"
    echo ""
    echo "  ${BAR_VAR}ZENMUX_MANAGEMENT_API_KEY=${API_KEY} ${SCRIPT_PATH}"
    echo ""
  fi
else
  echo ""
  echo "Creating .claude/settings.local.json with statusLine configuration..."
  mkdir -p "${PWD}/.claude"
  cat > "$SETTINGS_FILE" <<EOF
{
  "statusLine": {
    "type": "command",
    "command": "${BAR_VAR}ZENMUX_MANAGEMENT_API_KEY=${API_KEY} ${SCRIPT_PATH}"
  }
}
EOF
  echo "API key stored in $SETTINGS_FILE"
  echo ""
  echo "NOTE: The API key is scoped to this project's Claude Code settings."
  echo "It will only be visible in the statusLine command — not your shell environment."
fi

echo ""
echo "=== Installation complete ==="
