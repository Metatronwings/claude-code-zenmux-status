#!/usr/bin/env bash
set -euo pipefail

API_KEY="${ZENMUX_MANAGEMENT_API_KEY:-}"
if [[ -z "$API_KEY" ]]; then
  echo "ZENMUX_MANAGEMENT_API_KEY must be set" >&2
  exit 1
fi

TTL="${ZENMUX_CACHE_TTL:-60}"
USE_BAR="${ZENMUX_PROGRESS_BAR:-0}"
COMPACT=0
[[ "${ZENMUX_COMPACT:-0}" == "1" || "$(tput cols 2>/dev/null || echo 0)" -lt 120 && "$(tput cols 2>/dev/null || echo 0)" -gt 0 ]] && COMPACT=1
API_URL="https://zenmux.ai/api/v1/management/subscription/detail"

# Cache key: sha256 of API key + mode, first 16 hex chars
CACHE_SUFFIX=""
[[ "$USE_BAR" == "1" ]] && CACHE_SUFFIX=":bar"
[[ "$COMPACT" == "1" ]] && CACHE_SUFFIX+=":compact"
if command -v sha256sum &>/dev/null; then
  CACHE_KEY=$(printf '%s' "${API_KEY}${CACHE_SUFFIX}" | sha256sum | cut -c1-16)
else
  CACHE_KEY=$(printf '%s' "${API_KEY}${CACHE_SUFFIX}" | shasum -a 256 | cut -c1-16)
fi
CACHE_FILE="/tmp/zenmux-status-${CACHE_KEY}.cache"
LOCK_DIR="${CACHE_FILE}.lock"

# ---- helpers ----

_atomic_write() {
  local target="$1" content="$2"
  local tmp="${target}.tmp.$$"
  printf '%s' "$content" > "$tmp"
  mv "$tmp" "$target"
}

_try_lock() { mkdir "$LOCK_DIR" 2>/dev/null && return 0 || return 1; }
_unlock()   { rmdir "$LOCK_DIR" 2>/dev/null || true; }

color_pct() {
  local p=$1
  if awk "BEGIN {exit !($p >= 0.80)}"; then printf '\x1b[31m'
  elif awk "BEGIN {exit !($p >= 0.50)}"; then printf '\x1b[33m'
  else printf '\x1b[32m'; fi
}

fmt_pct() {
  awk "BEGIN {printf \"%.1f%%\", $1 * 100}"
}

parse_iso_ts() {
  local iso=${1//Z/+00:00}
  date -d "$iso" +%s 2>/dev/null || true
}

fmt_reset() {
  local iso=$1
  if [[ "$iso" == "null" || -z "$iso" ]]; then echo "(inactive)"; return; fi
  local ts
  ts=$(parse_iso_ts "$iso")
  if [[ -z "$ts" ]]; then echo "↻?"; return; fi
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
  local filled="" i
  for ((i=0; i<full; i++)); do filled+="█"; done
  local remain=$((10 - full - ${#partial}))
  local empty=""
  for ((i=0; i<remain; i++)); do empty+="░"; done
  echo -n "${filled}${partial}${empty}"
}

fmtk() {
  local n=$1
  if [[ $n -ge 1000000 ]]; then awk "BEGIN {printf \"%.1fM\", $n / 1000000}"
  elif [[ $n -ge 1000 ]]; then echo "$(( (n + 500) / 1000 ))k"
  else echo "$n"; fi
}

fmt_duration() {
  local sec=$1
  if [[ $sec -lt 60 ]]; then echo "${sec}s"; return; fi
  local m=$((sec / 60))
  if [[ $m -lt 60 ]]; then echo "${m}m"; return; fi
  local h=$((m / 60)) rm=$((m % 60))
  if [[ $h -lt 24 ]]; then echo "${h}h ${rm}m"; return; fi
  local d=$((h / 24)) rh=$((h % 24))
  echo "${d}d ${rh}h"
}

format_model_name() {
  local raw=$1
  local name=${raw##*/}
  name=${name#claude-}
  if [[ "$name" =~ ^([a-zA-Z]+)[-.]([0-9]+)[-.]([0-9]+) ]]; then
    local family=${BASH_REMATCH[1]} major=${BASH_REMATCH[2]} minor=${BASH_REMATCH[3]}
    echo "$(echo "$family" | sed 's/./\u&/') ${major}.${minor}"
  else
    echo "${name}"
  fi
}

# Resolve the ~/.claude/projects/<key> dir holding this session's JSONL.
# In a git worktree, Claude Code still writes the JSONL under the *main
# worktree root*'s project key — not the worktree's path — so fall back from
# $PWD's key to the main worktree root's key (via git rev-parse --git-common-dir).
_resolve_session_dir() {
  local dir="${HOME}/.claude/projects/${PWD//\//-}"
  if [[ -d "$dir" ]]; then echo "$dir"; return 0; fi
  local common
  common=$(git rev-parse --git-common-dir 2>/dev/null) || return 1
  case "$common" in
    /*) ;;
    *) common="$PWD/$common" ;;
  esac
  [[ "$common" == */.git ]] || return 1
  local root="${common%/.git}"
  dir="${HOME}/.claude/projects/${root//\//-}"
  if [[ -d "$dir" ]]; then echo "$dir"; return 0; fi
  return 1
}

get_model_name() {
  local session_dir
  session_dir=$(_resolve_session_dir) || return
  local latest
  latest=$(ls -t "$session_dir"/*.jsonl 2>/dev/null | head -1)
  [[ -n "$latest" ]] || return
  local model
  model=$(jq -r 'select(.type == "assistant" and .message.model != null) | .message.model' "$latest" 2>/dev/null | tail -1)
  [[ -n "$model" && "$model" != "null" ]] || return
  local name
  name=$(format_model_name "$model")
  local input_tokens ctx=""
  input_tokens=$(jq -r 'select(.type == "assistant" and .message.usage.input_tokens != null) | .message.usage | ((.input_tokens // 0) + (.cache_read_input_tokens // 0))' "$latest" 2>/dev/null | tail -1)
  if [[ -n "$input_tokens" && "$input_tokens" != "null" && "$input_tokens" != "0" && "$input_tokens" -gt 0 ]]; then
    local pct
    pct=$(awk "BEGIN {printf \"%.1f\", $input_tokens * 100 / 1000000}")
    local color
    if awk "BEGIN {exit !($pct > 80)}"; then color='\x1b[31m'
    elif awk "BEGIN {exit !($pct > 50)}"; then color='\x1b[33m'
    else color='\x1b[32m'; fi
    ctx=" ${color}${pct}%\x1b[0m"
  fi
  echo "[${name}${ctx}]"
}

get_token_stats() {
  local session_dir
  session_dir=$(_resolve_session_dir) || return
  local latest
  latest=$(ls -t "$session_dir"/*.jsonl 2>/dev/null | head -1)
  [[ -n "$latest" ]] || return

  local total_lines
  total_lines=$(wc -l < "$latest" 2>/dev/null || echo 0)

  local BASELINE_FILE="/tmp/czs-baselines.json"

  # Clean stale entries
  if [[ -f "$BASELINE_FILE" ]]; then
    local stale_list="" key
    while IFS= read -r key; do
      [[ -z "$key" ]] && continue
      [[ -f "$key" ]] || stale_list="${stale_list}[\"$key\"],"
    done < <(jq -r 'keys[]' "$BASELINE_FILE" 2>/dev/null)
    if [[ -n "$stale_list" ]]; then
      jq "del(${stale_list%,})" "$BASELINE_FILE" > "${BASELINE_FILE}.tmp" 2>/dev/null && \
        mv "${BASELINE_FILE}.tmp" "$BASELINE_FILE"
    fi
  fi

  local stored_input=0 stored_cache=0 stored_output=0 stored_line=0
  local sess_input=0 sess_cache=0 sess_output=0
  local has_baseline=false started_at=0

  if [[ -f "$BASELINE_FILE" ]]; then
    local base_line
    base_line=$(jq -r ".[\"$latest\"].lineCount // 0" "$BASELINE_FILE" 2>/dev/null)
    if [[ "$base_line" -gt 0 ]]; then
      has_baseline=true
      stored_input=$(jq -r ".[\"$latest\"].input // 0" "$BASELINE_FILE" 2>/dev/null)
      stored_cache=$(jq -r ".[\"$latest\"].cacheRead // 0" "$BASELINE_FILE" 2>/dev/null)
      stored_output=$(jq -r ".[\"$latest\"].output // 0" "$BASELINE_FILE" 2>/dev/null)
      sess_input=$(jq -r ".[\"$latest\"].sessionInput // .[\"$latest\"].input // 0" "$BASELINE_FILE" 2>/dev/null)
      sess_cache=$(jq -r ".[\"$latest\"].sessionCacheRead // .[\"$latest\"].cacheRead // 0" "$BASELINE_FILE" 2>/dev/null)
      sess_output=$(jq -r ".[\"$latest\"].sessionOutput // .[\"$latest\"].output // 0" "$BASELINE_FILE" 2>/dev/null)
      started_at=$(jq -r ".[\"$latest\"].startedAt // 0" "$BASELINE_FILE" 2>/dev/null)
      stored_line=$base_line
    fi
  fi

  local cur_input=$stored_input cur_cache=$stored_cache cur_output=$stored_output

  if [[ "$total_lines" -gt "$stored_line" ]]; then
    local start=$((stored_line + 1))
    local tail_out
    tail_out=$(tail -n +"$start" "$latest" 2>/dev/null | jq -s '
      [.[] | select(.type == "assistant" and .message.usage and .message.id)]
      | group_by(.message.id)
      | map(.[0].message.usage)
      | {
          input: (map(.input_tokens // 0) | add),
          cacheRead: (map(.cache_read_input_tokens // 0) | add),
          output: (map(.output_tokens // 0) | add)
        }
    ' 2>/dev/null)

    if [[ -n "$tail_out" && "$tail_out" != "null" ]]; then
      local add_input add_cache add_output
      add_input=$(echo "$tail_out" | jq -r '.input // 0')
      add_cache=$(echo "$tail_out" | jq -r '.cacheRead // 0')
      add_output=$(echo "$tail_out" | jq -r '.output // 0')
      cur_input=$((stored_input + add_input))
      cur_cache=$((stored_cache + add_cache))
      cur_output=$((stored_output + add_output))
    fi
  fi

  local now_sec
  now_sec=$(date +%s)

  if ! $has_baseline; then
    sess_input=$cur_input
    sess_cache=$cur_cache
    sess_output=$cur_output
    started_at=$now_sec
  fi

  # Save baseline (use += to keep model/lastContextTokens from TS version)
  [[ -f "$BASELINE_FILE" ]] || echo '{}' > "$BASELINE_FILE"
  jq --arg path "$latest" \
    --argjson input "$cur_input" \
    --argjson cacheRead "$cur_cache" \
    --argjson output "$cur_output" \
    --argjson sessionInput "$sess_input" \
    --argjson sessionCacheRead "$sess_cache" \
    --argjson sessionOutput "$sess_output" \
    --argjson startedAt "$started_at" \
    --argjson lineCount "$total_lines" \
    '.[$path] += {input: $input, cacheRead: $cacheRead, output: $output, sessionInput: $sessionInput, sessionCacheRead: $sessionCacheRead, sessionOutput: $sessionOutput, startedAt: $startedAt, lineCount: $lineCount}' \
    "$BASELINE_FILE" > "${BASELINE_FILE}.tmp" 2>/dev/null && \
    mv "${BASELINE_FILE}.tmp" "$BASELINE_FILE"

  local delta_input=$((cur_input - sess_input))
  local delta_cache=$((cur_cache - sess_cache))
  local delta_output=$((cur_output - sess_output))
  [[ $delta_input -lt 0 ]] && delta_input=0
  [[ $delta_cache -lt 0 ]] && delta_cache=0
  [[ $delta_output -lt 0 ]] && delta_output=0

  local dur_sec=$((now_sec - started_at))
  local dur_str cache_str in_str out_str
  dur_str=$(fmt_duration "$dur_sec")
  cache_str=$(fmtk "$delta_cache")
  in_str=$(fmtk "$delta_input")
  out_str=$(fmtk "$delta_output")
  echo " ⏱${dur_str} | ↖${cache_str} ↑${in_str} ↓${out_str}"
}

# ---- fetch + format (sets global LINE) ----

_fetch_and_format() {
  local TMP_HEADERS TMP_BODY
  TMP_HEADERS=$(mktemp)
  TMP_BODY=$(mktemp)
  trap 'rm -f "$TMP_HEADERS" "$TMP_BODY"' RETURN

  HTTP_CODE=$(curl -sS -D "$TMP_HEADERS" -o "$TMP_BODY" -w "%{http_code}" \
    -H "Authorization: Bearer ${API_KEY}" "$API_URL")

  if [[ "$HTTP_CODE" != "200" ]]; then
    echo "⚡ ERR: HTTP ${HTTP_CODE}"
    return 1
  fi

  BODY=$(cat "$TMP_BODY")

  SUCCESS=$(echo "$BODY" | jq -r '.success')
  if [[ "$SUCCESS" != "true" ]]; then
    MSG=$(echo "$BODY" | jq -r '.message // "API returned no data"')
    echo "⚡ ERR: ${MSG}"
    return 1
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

  C5H=$(color_pct "$PCT5H")
  C7D=$(color_pct "$PCT7D")
  R5=$(fmt_reset "$RESET5H")
  R7=$(fmt_reset "$RESET7D")

  if [[ "$USE_BAR" == "1" ]]; then
    MODEL_PREFIX=""
    if [[ -z "${ZENMUX_NO_MODEL:-}" ]]; then
      MODEL_PREFIX=$(get_model_name)
      [[ -n "$MODEL_PREFIX" ]] && MODEL_PREFIX="${MODEL_PREFIX} "
    fi
    if [[ "$COMPACT" == "1" ]]; then
      LINE="${MODEL_PREFIX}${EMO} 5h:${C5H}$(fmt_pct "$PCT5H")\x1b[0m ${R5} | 7d:${C7D}$(fmt_pct "$PCT7D")\x1b[0m ${R7}"
    else
      BAR5="${C5H}$(render_bar "$PCT5H")\x1b[0m"
      BAR7="${C7D}$(render_bar "$PCT7D")\x1b[0m"
      LINE="${MODEL_PREFIX}${EMO} ${BAR5} $(fmt_pct "$PCT5H") ${R5} | 7d ${BAR7} $(fmt_pct "$PCT7D") ${R7}"
    fi
    [[ -n "$BAD" ]] && LINE="${BAD# } | ${LINE}"
  else
    LINE="${EMO} ${TIER}${BAD} | 5h ${C5H}$(fmt_pct "$PCT5H")\x1b[0m \$${USED5H}/\$${MAX5H} ${R5} | 7d ${C7D}$(fmt_pct "$PCT7D")\x1b[0m \$${USED7D}/\$${MAX7D} ${R7}"
  fi

  return 0
}

# ---- main ----

# Git info (always fresh, never cached)
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
DIRTY=""
[[ -n "$(git status --porcelain 2>/dev/null)" ]] && DIRTY=" ✗"

SHORT_CWD="${PWD/#$HOME/~}"
GIT_LINE="📁${SHORT_CWD}"
[[ -n "$BRANCH" && "$BRANCH" != "HEAD" ]] && GIT_LINE+=" | 🌿(${BRANCH})${DIRTY}"

TOKEN_STATS=$(get_token_stats)

# 1. Cache hit → output and exit
if [[ -f "$CACHE_FILE" ]]; then
  mtime=0
  if stat -c %Y "$CACHE_FILE" &>/dev/null; then
    mtime=$(stat -c %Y "$CACHE_FILE")
  else
    mtime=$(stat -f %m "$CACHE_FILE")
  fi
  age=$(($(date +%s) - mtime))
  if [[ "$age" -lt "$TTL" ]]; then
    echo -e "$(cat "$CACHE_FILE")${TOKEN_STATS}\n${GIT_LINE}"
    exit 0
  fi
fi

# 2. Cache miss → try lock → only one process fetches
if _try_lock; then
  if _fetch_and_format; then
    _atomic_write "$CACHE_FILE" "$LINE"
    echo -e "${LINE}${TOKEN_STATS}\n${GIT_LINE}"
  fi
  _unlock
  exit 0
fi

# 3. Lock held by another process → wait up to 5s for cache
WAIT_DEADLINE=$(($(date +%s) + 5))
while [[ $(date +%s) -lt $WAIT_DEADLINE ]]; do
  sleep 0.2
  if [[ -f "$CACHE_FILE" ]]; then
    echo -e "$(cat "$CACHE_FILE")${TOKEN_STATS}\n${GIT_LINE}"
    exit 0
  fi
done

# 4. Timeout → fall back to direct fetch (no lock)
if _fetch_and_format; then
  _atomic_write "$CACHE_FILE" "$LINE"
  echo -e "${LINE}${TOKEN_STATS}\n${GIT_LINE}"
fi
exit 0
