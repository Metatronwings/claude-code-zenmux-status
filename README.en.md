# claude-code-zenmux-status

[中文](README.md)

Display your [Zenmux](https://zenmux.ai) subscription usage, session token stats, and Git status in the Claude Code status bar.

**Default mode:**
```
💎 ultra | 5h 8.1% $2.13/$26.27 ↻4h 20m | 7d 81.3% $165.13/$202.98 ↻23h 22m
📁~/project 🌿(main) ✗ ~3 ?1
```

**Progress bar mode (`ZENMUX_PROGRESS_BAR=1`):**
```
[Sonnet 4.6] 💎 ▓░░░░░░░░░ 8.1% | 7d ████████░░ 81.3% | ↑9.0M ↓56k
📁~/project 🌿(main) ✗ ~3 ?1
```

### Line 1 — Subscription usage

- Tier emoji: 💎 Ultra / 🔥 Max / ⭐ Pro / 🌱 Free
- `5h` — 5-hour rolling window
- `7d` — 7-day rolling window (always shown by default; set `ZENMUX_HIDE_7D_BELOW_70=1` to hide when below 70%)
- Progress bar mode also shows: current model `[Sonnet 4.6]` and session token delta `↑input ↓output` (resets to 0 each time you open CC)
- Abnormal account states are shown inline, e.g. `[monitored]`

### Line 2 — Workspace status

- `📁` Current working directory (`~`-abbreviated)
- `🌿(branch)` Git branch
- `✗` Shown when there are uncommitted changes, followed by counts: `+added` (green) `~modified` (yellow) `?untracked` (red)

## Get your API key

1. Go to the [ZenMux Console](https://zenmux.ai/platform/management)
2. Create a **Management API Key**
3. Copy the key

## Installation

### Option 1: npm global install

```bash
npm install -g @metatronwings/claude-code-zenmux-status
```

Add to your `.claude/settings.local.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "ZENMUX_MANAGEMENT_API_KEY=your_key_here claude-code-zenmux-status"
  }
}
```

To enable progress bar mode:

```json
{
  "statusLine": {
    "type": "command",
    "command": "ZENMUX_PROGRESS_BAR=1 ZENMUX_MANAGEMENT_API_KEY=your_key_here claude-code-zenmux-status"
  }
}
```

Or export the key in `~/.zshrc` / `~/.bashrc` and use just `claude-code-zenmux-status` as the command.

### Option 2: Clone and run locally

```bash
git clone https://github.com/Metatronwings/claude-code-zenmux-status.git
cd claude-code-zenmux-status
npm install
```

Add to your `.claude/settings.local.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "ZENMUX_MANAGEMENT_API_KEY=your_key_here /path/to/node_modules/.bin/tsx /path/to/src/index.ts"
  }
}
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZENMUX_MANAGEMENT_API_KEY` | Yes | Management API Key |
| `ZENMUX_PROGRESS_BAR` | No | Set to `1` to enable progress bar mode |
| `ZENMUX_HIDE_7D_BELOW_70` | No | Set to `1` to hide the 7d window when usage is below 70% |
| `ZENMUX_CACHE_TTL` | No | Cache TTL in seconds, default `60` |

## Caching

The Claude Code status bar refreshes after every AI response, which can mean multiple executions per minute during active sessions. To avoid hitting API rate limits, the tool uses file-based caching:

- Default TTL: **60 seconds**, cache hits respond in < 30ms
- Cache file: `/tmp/czs-<key_hash>.cache` (first 16 chars of the key's SHA-256, no plaintext)
- Git status, current directory, and session token counts are always read fresh — never cached

## Time calculation

All countdowns use the `Date` header from the API response as the current time reference, not the local system clock. This ensures correct display across any timezone or clock skew environment.
