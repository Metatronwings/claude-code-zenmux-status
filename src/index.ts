import { fetchDetail } from "./api.js";
import { formatStatus, formatDuration } from "./format.js";
import type { DisplayMode } from "./format.js";
import { readCache, writeCache, tryAcquireLock, releaseLock, waitForCache } from "./cache.js";
import { getSessionStats, formatModelName } from "./session.js";
import { buildGitLine } from "./git.js";
import { safeNum, pctColor } from "./utils.js";

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

const apiKey = process.env.ZENMUX_MANAGEMENT_API_KEY;

if (!apiKey) {
  process.stderr.write("ZENMUX_MANAGEMENT_API_KEY must be set\n");
  process.exit(1);
}

const ttlMs = safeNum(process.env.ZENMUX_CACHE_TTL, 60) * 1000;
const useBar = process.env.ZENMUX_PROGRESS_BAR === "1";
const hide7dBelow70 = process.env.ZENMUX_HIDE_7D_BELOW_70 === "1";
const compact = process.env.ZENMUX_COMPACT === "1";
const apiTimeoutMs = safeNum(process.env.ZENMUX_API_TIMEOUT, 5) * 1000;

// Determine display mode from env vars: compact > bar > full
const displayMode: DisplayMode = compact ? "compact" : useBar ? "bar" : "full";

// Session stats and git line are always fresh — never cached
const cwd = process.cwd();
const session = getSessionStats(cwd);
let modelPrefix = "";
if (session?.model) {
  let ctx = "";
  if (session.contextPct != null) {
    const pct = session.contextPct;
    ctx = ` ${pctColor(pct)}${(pct * 100).toFixed(1)}%\x1b[0m`;
  }
  modelPrefix = `[${formatModelName(session.model)}${ctx}] `;
}
const tokenSuffix = session ? ` ⏱${formatDuration(session.durationSec * 1000, true)} | ↖${fmtK(session.cacheReadTokens)} ↑${fmtK(session.inputTokens)} ↓${fmtK(session.outputTokens)}` : "";
const gitLine = buildGitLine();

// Include display options in cache key so toggling doesn't serve wrong-format cache
const cacheKey = apiKey + (useBar ? ":bar" : "") + (compact ? ":compact" : "") + (hide7dBelow70 ? ":hide7d" : "");

function emitOk(body: string): void {
  process.stdout.write(modelPrefix + body + tokenSuffix + "\n" + gitLine + "\n");
}

function emitErr(msg: string): void {
  process.stdout.write(`⚡ ERR: ${msg}\n` + gitLine + "\n");
}

async function fetchFormatAndOutput(): Promise<void> {
  try {
    const { detail, serverNowMs } = await fetchDetail(apiKey!, apiTimeoutMs);
    const out = formatStatus(detail, serverNowMs, displayMode, hide7dBelow70);
    writeCache(cacheKey, out);
    emitOk(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitErr(msg);
  }
}

const cached = readCache(cacheKey, ttlMs);
if (cached !== null) {
  emitOk(cached);
  process.exit(0);
}

// Cache miss — use a lock so only one process hits the API
if (tryAcquireLock(cacheKey)) {
  try {
    await fetchFormatAndOutput();
  } finally {
    releaseLock(cacheKey);
  }
  process.exit(0);
}

// Another process holds the lock — wait up to 5s for it to populate the cache
const waited = await waitForCache(cacheKey, 5000, ttlMs);
if (waited !== null) {
  emitOk(waited);
  process.exit(0);
}

// Timed out — fall back to fetching directly
await fetchFormatAndOutput();
process.exit(0);
