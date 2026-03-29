# claude-code-zenmux-status

[中文](README.md)

Display your [Zenmux](https://zenmux.ai) subscription usage in the Claude Code status bar.

```
⚡ ultra | 7d 13.8% $27.95/$202.98 ↻4d 5h | 5h 24.8% $6.52/$26.27 ↻43m
```

- `7d` — 7-day rolling window: usage %, spent/limit (USD), time until reset
- `5h` — 5-hour rolling window: usage %, spent/limit (USD), time until reset
- Abnormal account states are shown inline, e.g. `⚡ ultra [monitored]`

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

Or export the key in `~/.zshrc` / `~/.bashrc` and use just `claude-code-zenmux-status` as the command.

### Option 2: Clone and run locally

```bash
git clone https://github.com/Metatronwings/claude-code-zenmux-status.git
cd claude-code-zenmux-status
npm install
npm run build      # optional, faster startup
echo "ZENMUX_MANAGEMENT_API_KEY=your_key_here" > .env
```

Add to your `.claude/settings.local.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "/absolute/path/to/claude-code-zenmux-status/status.sh"
  }
}
```

`status.sh` loads `.env` automatically and prefers the compiled `dist/index.js`, falling back to `tsx` if not built.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZENMUX_MANAGEMENT_API_KEY` | Yes | Management API Key |
| `ZENMUX_CACHE_TTL` | No | Cache TTL in seconds, default `60` |

## Caching

The Claude Code status bar refreshes after every AI response, which can mean multiple executions per minute during active sessions. To avoid hitting API rate limits, the tool uses file-based caching:

- Default TTL: **60 seconds**, cache hits respond in < 30ms
- Cache file: `/tmp/czs-<key_hash>.cache` (first 16 chars of the key's SHA-256, no plaintext)
- Read/write failures are silently ignored with automatic fallback to live requests

## Time calculation

All countdowns use the `Date` header from the API response as the current time reference, not the local system clock. This ensures correct display across any timezone or clock skew environment.

