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

# Detect shell rc file
SHELL_NAME=$(basename "$SHELL")
case "$SHELL_NAME" in
  zsh) RC_FILE="${HOME}/.zshrc" ;;
  bash) RC_FILE="${HOME}/.bashrc" ;;
  *) RC_FILE="${HOME}/.${SHELL_NAME}rc" ;;
esac

# Add API key to rc file if not already present
if ! grep -q "ZENMUX_MANAGEMENT_API_KEY" "$RC_FILE" 2>/dev/null; then
  {
    echo ""
    echo "# Zenmux Status"
    echo "export ZENMUX_MANAGEMENT_API_KEY=\"${API_KEY}\""
  } >> "$RC_FILE"
  echo "API key added to $RC_FILE"
else
  echo "ZENMUX_MANAGEMENT_API_KEY already exists in $RC_FILE, skipping"
fi

# Prompt for progress bar
echo -n "Enable progress bar mode? [y/N]: "
read -r BAR_REPLY </dev/tty
echo ""

if [[ "$BAR_REPLY" =~ ^[Yy]$ ]]; then
  if ! grep -q "ZENMUX_PROGRESS_BAR=1" "$RC_FILE" 2>/dev/null; then
    echo "export ZENMUX_PROGRESS_BAR=1" >> "$RC_FILE"
    echo "Progress bar mode enabled in $RC_FILE"
  else
    echo "ZENMUX_PROGRESS_BAR already enabled, skipping"
  fi
fi

# Configure Claude Code settings if present
SETTINGS_FILE="${PWD}/.claude/settings.local.json"
if [[ -f "$SETTINGS_FILE" ]]; then
  echo "Found $SETTINGS_FILE, updating statusLine..."
  if command -v jq &>/dev/null; then
    BAR_VAR=""
    [[ "$BAR_REPLY" =~ ^[Yy]$ ]] && BAR_VAR="ZENMUX_PROGRESS_BAR=1 "
    tmp=$(mktemp)
    jq --arg cmd "${BAR_VAR}ZENMUX_MANAGEMENT_API_KEY=${API_KEY} ${SCRIPT_PATH}" \
      '.statusLine = {"type":"command","command":$cmd}' \
      "$SETTINGS_FILE" > "$tmp" && mv "$tmp" "$SETTINGS_FILE"
    echo "Updated $SETTINGS_FILE"
  else
    echo "jq not found, cannot auto-update $SETTINGS_FILE"
    echo "Please manually update your statusLine command:"
    echo ""
    BAR_VAR=""
    [[ "$BAR_REPLY" =~ ^[Yy]$ ]] && BAR_VAR="ZENMUX_PROGRESS_BAR=1 "
    echo "  ${BAR_VAR}ZENMUX_MANAGEMENT_API_KEY=${API_KEY} ${SCRIPT_PATH}"
    echo ""
  fi
else
  echo ""
  echo "No .claude/settings.local.json found in current directory."
  echo "Add this to your .claude/settings.local.json to enable the status bar:"
  echo ""
  BAR_VAR=""
  [[ "$BAR_REPLY" =~ ^[Yy]$ ]] && BAR_VAR="ZENMUX_PROGRESS_BAR=1 "
  cat <<EOF
{
  "statusLine": {
    "type": "command",
    "command": "${BAR_VAR}ZENMUX_MANAGEMENT_API_KEY=${API_KEY} ${SCRIPT_PATH}"
  }
}
EOF
fi

echo ""
echo "=== Installation complete ==="
echo "Please run: source $RC_FILE"
