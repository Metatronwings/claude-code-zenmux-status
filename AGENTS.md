# AGENTS.md

Guidance for AI coding agents working on this repository.

## Project overview

`claude-code-zenmux-status` (npm: `@metatronwings/claude-code-zenmux-status`) is a single-purpose status-bar command for [Claude Code](https://claude.ai/code). It prints two lines to stdout and exits:

1. **Zenmux subscription usage** — plan tier emoji (💎 Ultra / 🔥 Max / ⭐ Pro / 🌱 Free), 5-hour and 7-day rolling quota windows (percentage, `$used/$max`, reset countdown), plus the current model name, context-window percentage, session duration, and per-session token deltas.
2. **Workspace status** — current directory (`~`-abbreviated), git branch, and change counts (`+added ~modified -deleted ?untracked`, ANSI-colored).

Claude Code's `statusLine` setting invokes the command after every AI reply, so it must be fast and safe to run many times per minute. A file cache (default 60s TTL) plus an inter-process lock keeps API traffic to one request per TTL window.

There are **two parallel implementations** of the same tool:

- `src/*.ts` — TypeScript/Node version, published to npm as the `claude-code-zenmux-status` bin.
- `zenmux-status.sh` — standalone Bash port (deps: `bash`, `curl`, `jq`) for users without Node.js, installed via `install.sh`.

When you change user-facing behavior (output format, env vars, caching), **mirror the change in both implementations** and update both READMEs (see "Documentation conventions" below).

## Tech stack

- TypeScript, ESM (`"type": "module"`), Node.js >= 18.
- **Zero runtime dependencies** — Node built-ins and native `fetch` only. Keep it that way; do not add dependencies without a strong reason (the package is a global CLI and the bash port must stay equivalent).
- Dev tooling: `tsup` (build), `tsx` (run without compiling), `typescript` (typecheck).

## Build and run commands

```bash
npm run build     # tsup: src/ → dist/index.js (ESM, #!/usr/bin/env node banner), chmod +x
npm run dev       # run src/index.ts directly via tsx
npm run status    # alias for dev
```

- `tsconfig.json`: `strict: true`, `module`/`moduleResolution: NodeNext`, target ES2022. Imports of local files use the `.js` suffix (`./api.js`) even though sources are `.ts` — required by NodeNext.
- `status.sh` is a local helper that sources `.env` (copy from `.env.example`) and runs `dist/index.js` if built, else `tsx src/index.ts`.
- `dist/` is gitignored (built on demand and at publish time via `prepublishOnly`); `docs/superpowers/` and `.claude/` are gitignored too, so design docs and local settings stay local.

## Testing

**There are no automated tests.** Verification is manual: run `npm run dev` (or `status.sh`) with a valid `ZENMUX_MANAGEMENT_API_KEY` and inspect the two output lines. `ZENMUX_CACHE_TTL=1` is handy to bypass the cache while debugging. `docs/superpowers/{plans,specs}/` holds dated design docs from earlier changes — check them for rationale before touching session-resolution or robustness logic.

## Architecture

Entry point `src/index.ts` orchestrates; each module has one job:

- `src/api.ts` — Fetches `https://<domain>/api/v1/management/subscription/detail` (`ZENMUX_API_DOMAIN` overrides the default `zenmux.ai`; scheme/slashes are stripped). Returns the payload plus `serverNowMs` parsed from the HTTP `Date` header — **all countdowns are computed against the server clock, never the local clock**, so displays are correct under clock skew. Default 5s `AbortSignal.timeout`.
- `src/cache.ts` — File cache in `os.tmpdir()` (`czs-<sha256(key)[:16]>.cache`, mode 0600 atomic write). On a miss, an inter-process lock (`mkdir`, atomic on all platforms) elects one process to fetch; stale locks (>10s) are reclaimed via atomic `rename`; losers poll the cache for up to 5s before fetching themselves.
- `src/format.ts` — Renders the usage line in three `DisplayMode`s: `full` (dollar amounts), `bar` (gradient block bars `█▓▒░`), `compact` (minimal). Also `formatDuration` and UTC parsing that treats offset-less ISO strings as UTC.
- `src/session.ts` — Locates the current Claude Code session's JSONL transcript and sums token usage. Resolution order: (1) `transcript_path` from the JSON Claude Code pipes to the statusLine command on stdin (always correct); (2) inference from `~/.claude/sessions/<pid>.json` + candidate `~/.claude/projects/<key>/` dirs, where the key derives from cwd **and** the main worktree root (`git rev-parse --git-common-dir`) because Claude Code files worktree sessions under the main root; (3) most-recently-modified `.jsonl` fallback. Never cached.
- `src/baseline.ts` — Persists per-transcript state (`czs-bl-*.json`) so token counters increment from where the last run stopped and reset per new Claude Code session.
- `src/git.ts` — Branch + porcelain status counts, always read fresh.
- `src/utils.ts` — `tmpPath` (hashed temp paths), `atomicWriteJson`, `pctColor` (red >80%, yellow >50%, green otherwise), `safeNum` (env var parsing).

The cache key includes the display-mode flags, so toggling modes never serves a wrongly formatted cache entry.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ZENMUX_MANAGEMENT_API_KEY` | yes | Zenmux Management API key (from the Zenmux console) |
| `ZENMUX_PROGRESS_BAR` | no | `1` → progress-bar display mode |
| `ZENMUX_COMPACT` | no | `1` → compact mode (the bash version also auto-enables compact when `tput cols` < 120) |
| `ZENMUX_HIDE_7D_BELOW_70` | no | `1` → hide the 7d window while usage < 70% |
| `ZENMUX_CACHE_TTL` | no | cache seconds, default 60 |
| `ZENMUX_API_TIMEOUT` | no | API timeout seconds, default 5 |
| `ZENMUX_API_DOMAIN` | no | replace `zenmux.ai` (e.g. self-hosted mirror) |

## Code style

- Strict TypeScript, 2-space indent, double quotes, semicolons; matches the existing files.
- Concise comments that explain **why** (protocol quirks, race conditions, worktree behavior), not what — follow the density already in `src/`.
- Every failure path degrades gracefully: the status line must always print something (cached value, zeros, or `⚡ ERR: <msg>`) and exit 0 where possible, because it runs inside the user's prompt UI.

## Security considerations

- The API key is a secret: it is never logged or written to disk in plaintext — cache/baseline filenames use the first 16 hex chars of its SHA-256, and temp files are written mode 0600 via write-tmp + atomic rename.
- `install.sh` stores the key in the project's `.claude/settings.local.json` (inline in the statusLine command), deliberately **not** in shell rc files, which are world-readable. `.claude/` and `.env` are gitignored; keep it that way and never commit keys.
- Git invocations are hardened against malicious repos: `GIT_CONFIG_NOSYSTEM=1`, `GIT_OPTIONAL_LOCKS=0`, and `git -c core.fsmonitor=` so a repo's `.git/config` cannot make the status bar execute hooks. Preserve these flags when touching `git.ts` or the git lookup in `session.ts`; all `execSync` calls have 1s timeouts and ignore stderr.
- Output uses raw ANSI escapes; keep them balanced (`\x1b[0m` reset) so a malformed line can't corrupt the user's terminal.

## Deployment / publishing

- npm publish is automated: creating a **GitHub release** triggers `.github/workflows/publish.yml` (Node 20, `npm ci`, `npm publish --access public`, OIDC `id-token` for provenance). `prepublishOnly` runs the build.
- Version bumps happen in `package.json` before tagging the release.
- The bash version is distributed directly from the repo: users run `install.sh` (or `curl | bash` from the README), which downloads `zenmux-status.sh` from the `main` branch — so the script at repo root **is** the release artifact and must stay self-contained (no sourcing of other repo files).

## Documentation conventions

- User docs are bilingual: `README.md` is **Chinese (primary)**, `README.en.md` is the English mirror. Update both when user-facing behavior, env vars, or install steps change.
- `CLAUDE.md` describes the same architecture for Claude Code; keep it and this file in sync with the code.
