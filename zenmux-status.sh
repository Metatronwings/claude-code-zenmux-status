#!/usr/bin/env bash
set -euo pipefail

API_KEY="${ZENMUX_MANAGEMENT_API_KEY:-}"
if [[ -z "$API_KEY" ]]; then
  echo "ZENMUX_MANAGEMENT_API_KEY must be set" >&2
  exit 1
fi

TTL="${ZENMUX_CACHE_TTL:-60}"
USE_BAR="${ZENMUX_PROGRESS_BAR:-0}"
API_URL="https://zenmux.ai/api/v1/management/subscription/detail"

# Cache key: sha256 of API key + mode, first 16 hex chars
CACHE_SUFFIX=""
[[ "$USE_BAR" == "1" ]] && CACHE_SUFFIX=":bar"
if command -v sha256sum &>/dev/null; then
  CACHE_KEY=$(printf '%s' "${API_KEY}${CACHE_SUFFIX}" | sha256sum | cut -c1-16)
else
  CACHE_KEY=$(printf '%s' "${API_KEY}${CACHE_SUFFIX}" | shasum -a 256 | cut -c1-16)
fi
CACHE_FILE="/tmp/zenmux-status-${CACHE_KEY}.cache"

# Git info (always fresh)
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
DIRTY=""
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then DIRTY=" ✗"; fi

SHORT_CWD="${PWD/#$HOME/~}"
GIT_LINE="📁${SHORT_CWD}"
if [[ -n "$BRANCH" && "$BRANCH" != "HEAD" ]]; then
  GIT_LINE+=" | 🌿(${BRANCH})${DIRTY}"
fi

# Check cache
if [[ -f "$CACHE_FILE" ]]; then
  mtime=0
  if stat -c %Y "$CACHE_FILE" &>/dev/null; then
    mtime=$(stat -c %Y "$CACHE_FILE")
  else
    mtime=$(stat -f %m "$CACHE_FILE")
  fi
  age=$(($(date +%s) - mtime))
  if [[ "$age" -lt "$TTL" ]]; then
    echo -e "$(cat "$CACHE_FILE")\n${GIT_LINE}"
    exit 0
  fi
fi

TMP_HEADERS=$(mktemp)
TMP_BODY=$(mktemp)
trap 'rm -f "$TMP_HEADERS" "$TMP_BODY"' EXIT

HTTP_CODE=$(curl -sS -D "$TMP_HEADERS" -o "$TMP_BODY" -w "%{http_code}" \
  -H "Authorization: Bearer ${API_KEY}" "$API_URL")

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "⚡ ERR: HTTP ${HTTP_CODE}"
  exit 0
fi

BODY=$(cat "$TMP_BODY")

SUCCESS=$(echo "$BODY" | jq -r '.success')
if [[ "$SUCCESS" != "true" ]]; then
  MSG=$(echo "$BODY" | jq -r '.message // "API returned no data"')
  echo "⚡ ERR: ${MSG}"
  exit 0
fi

DATA=$(echo "$BODY" | jq '.data')
TIER=$(echo "$DATA" | jq -r '.plan.tier')
STATUS=$(echo "$DATA" | jq -r '.account_status')

Q5H=$(echo "$DATA" | jq '.quota_5_hour')
Q7D=$(echo "$DATA" | jq '.quota_7_day')

PCT5H=$(echo "$Q5H" | jq -r '.usage_percentage')
USED5H=$(echo "$Q5H" | jq -r '.used_value_usd')
MAX5H=$(echo "$Q5H" | jq -r '.max_value_usd')
RESET5H=$(echo "$Q5H" | jq -r '.resets_at')

PCT7D=$(echo "$Q7D" | jq -r '.usage_percentage')
USED7D=$(echo "$Q7D" | jq -r '.used_value_usd')
MAX7D=$(echo "$Q7D" | jq -r '.max_value_usd')
RESET7D=$(echo "$Q7D" | jq -r '.resets_at')

declare -A EMOJI=( [ultra]="💎" [max]="🔥" [pro]="⭐" [free]="🌱" )
declare -A BADGE=( [monitored]=" [monitored]" [abusive]=" [abusive]" [suspended]=" [suspended]" [banned]=" [banned]" )

EMO="${EMOJI[$TIER]:-⚡}"
BAD="${BADGE[$STATUS]:-}"

# Server time from HTTP Date header
SERVER_DATE=$(grep -i '^date:' "$TMP_HEADERS" | sed 's/^date: *//I' | tr -d '\r')
if [[ -n "$SERVER_DATE" ]]; then
  NOW=$(date -d "$SERVER_DATE" +%s 2>/dev/null || date -j -f "%a, %d %b %Y %H:%M:%S GMT" "$SERVER_DATE" +%s 2>/dev/null || date +%s)
else
  NOW=$(date +%s)
fi

# Helpers
color_pct() {
  local p=$1
  if awk "BEGIN {exit !($p >= 0.80)}"; then printf '\x1b[31m'
  elif awk "BEGIN {exit !($p >= 0.50)}"; then printf '\x1b[33m'
  else printf '\x1b[32m'; fi
}

fmt_pct() {
  local p=$1
  awk "BEGIN {printf \"%.1f%%\", $p * 100}"
}

parse_iso_ts() {
  local iso=$1
  iso=${iso//Z/+00:00}
  date -d "$iso" +%s 2>/dev/null || true
}

fmt_reset() {
  local iso=$1
  if [[ "$iso" == "null" || -z "$iso" ]]; then
    echo "(inactive)"
    return
  fi
  local ts
  ts=$(parse_iso_ts "$iso")
  if [[ -z "$ts" ]]; then
    echo "↻?"
    return
  fi
  local diff=$((ts - NOW))
  if [[ $diff -le 0 ]]; then echo "↻?"; return; fi
  local d=$((diff / 86400)) h=$(((diff % 86400) / 3600)) m=$(((diff % 3600) / 60))
  if [[ $d -gt 0 ]]; then echo "↻${d}d ${h}h"; elif [[ $h -gt 0 ]]; then echo "↻${h}h ${m}m"; else echo "↻${m}m"; fi
}

render_bar() {
  local rate=$1
  local pos full frac
  pos=$(awk "BEGIN {printf \"%f\", $rate * 10}")
  full=${pos%.*}
  frac=$(awk "BEGIN {printf \"%f\", $pos - $full}")
  local partial=""
  if awk "BEGIN {exit !($frac >= 0.75)}"; then partial="▓"
  elif awk "BEGIN {exit !($frac >= 0.50)}"; then partial="▒"
  elif awk "BEGIN {exit !($frac >= 0.25)}"; then partial="░"
  fi
  local filled=""
  local i
  for ((i=0; i<full; i++)); do filled+="█"; done
  local remain=$((10 - full - ${#partial}))
  local empty=""
  for ((i=0; i<remain; i++)); do empty+="░"; done
  echo -n "${filled}${partial}${empty}"
}

format_model_name() {
  local raw=$1
  local name=${raw##*/}
  name=${name#claude-}
  if [[ "$name" =~ ^([a-zA-Z]+)[-.]([0-9]+)[-.]([0-9]+) ]]; then
    local family=${BASH_REMATCH[1]}
    local major=${BASH_REMATCH[2]}
    local minor=${BASH_REMATCH[3]}
    echo "$(echo "$family" | sed 's/./\u&/') ${major}.${minor}"
  else
    echo "${name}"
  fi
}

get_model_name() {
  local project_key="${PWD//\//-}"
  local session_dir="${HOME}/.claude/projects/${project_key}"
  if [[ ! -d "$session_dir" ]]; then
    return
  fi
  local latest
  latest=$(ls -t "$session_dir"/*.jsonl 2>/dev/null | head -1)
  if [[ -z "$latest" ]]; then
    return
  fi
  local model
  model=$(jq -r 'select(.type == "assistant" and .message.model != null) | .message.model' "$latest" 2>/dev/null | tail -1)
  if [[ -z "$model" || "$model" == "null" ]]; then
    return
  fi
  local name
  name=$(format_model_name "$model")
  # Context percentage from last assistant message's input_tokens
  local input_tokens ctx=""
  input_tokens=$(jq -r 'select(.type == "assistant" and .message.usage.input_tokens != null) | .message.usage.input_tokens' "$latest" 2>/dev/null | tail -1)
  if [[ -n "$input_tokens" && "$input_tokens" != "null" && "$input_tokens" -gt 0 ]]; then
    local pct=$(( input_tokens * 100 / 1000000 ))
    if [[ $pct -gt 100 ]]; then pct=100; fi
    local color
    if [[ $pct -gt 80 ]]; then color='\x1b[31m'
    elif [[ $pct -gt 50 ]]; then color='\x1b[33m'
    else color='\x1b[32m'; fi
    ctx=" ${color}${pct}%\x1b[0m"
  fi
  echo "[${name}${ctx}]"
}

C5H=$(color_pct "$PCT5H")
C7D=$(color_pct "$PCT7D")
R5=$(fmt_reset "$RESET5H")
R7=$(fmt_reset "$RESET7D")

if [[ "$USE_BAR" == "1" ]]; then
  MODEL_PREFIX=""
  if [[ -n "${ZENMUX_NO_MODEL:-}" ]]; then
    MODEL_PREFIX=""
  else
    MODEL_PREFIX=$(get_model_name)
    [[ -n "$MODEL_PREFIX" ]] && MODEL_PREFIX="${MODEL_PREFIX} "
  fi
  BAR5="${C5H}$(render_bar "$PCT5H")\x1b[0m"
  BAR7="${C7D}$(render_bar "$PCT7D")\x1b[0m"
  LINE="${MODEL_PREFIX}${EMO} ${BAR5} $(fmt_pct "$PCT5H") ${R5} | 7d ${BAR7} $(fmt_pct "$PCT7D") ${R7}"
  if [[ -n "$BAD" ]]; then
    LINE="${BAD# } | ${LINE}"
  fi
else
  LINE="${EMO} ${TIER}${BAD} | 5h ${C5H}$(fmt_pct "$PCT5H")\x1b[0m \$${USED5H}/\$${MAX5H} ${R5} | 7d ${C7D}$(fmt_pct "$PCT7D")\x1b[0m \$${USED7D}/\$${MAX7D} ${R7}"
fi

# Cache only the Zenmux line; git line is always fresh
echo -e "${LINE}" > "$CACHE_FILE"

echo -e "${LINE}\n${GIT_LINE}"
