import { fetchDetail } from "./api.js";
import { formatStatus } from "./format.js";
import { readCache, writeCache, tryAcquireLock, releaseLock, waitForCache } from "./cache.js";
import { getSessionStats, formatModelName } from "./session.js";
import { buildGitLine } from "./git.js";

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

const apiKey = process.env.ZENMUX_MANAGEMENT_API_KEY;

if (!apiKey) {
  process.stderr.write("ZENMUX_MANAGEMENT_API_KEY must be set\n");
  process.exit(1);
}

/** Parse a numeric env var. Treats empty string and NaN/Infinity/negative as default. */
function safeNum(raw: string | undefined, defaultVal: number): number {
  if (raw === undefined || raw === "") return defaultVal;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : defaultVal;
}

const ttlMs = safeNum(process.env.ZENMUX_CACHE_TTL, 60) * 1000;
const useBar = process.env.ZENMUX_PROGRESS_BAR === "1";
const hide7dBelow70 = process.env.ZENMUX_HIDE_7D_BELOW_70 === "1";
const compact = process.env.ZENMUX_COMPACT === "1";
const apiTimeoutMs = safeNum(process.env.ZENMUX_API_TIMEOUT, 5) * 1000;

// Session stats and git line are always fresh — never cached
const cwd = process.cwd();
const session = useBar ? getSessionStats(cwd) : null;
let modelPrefix = "";
if (session?.model) {
  let ctx = "";
  if (session.contextPct != null) {
    const pct = session.contextPct;
    const color = pct > 0.80 ? "\x1b[31m" : pct > 0.50 ? "\x1b[33m" : "\x1b[32m";
    ctx = ` ${color}${(pct * 100).toFixed(1)}%\x1b[0m`;
  }
  modelPrefix = `[${formatModelName(session.model)}${ctx}] `;
}
const tokenSuffix = session ? ` ⏱${fmtDuration(session.durationSec)} | ↖${fmtK(session.cacheReadTokens)} ↑${fmtK(session.inputTokens)} ↓${fmtK(session.outputTokens)}` : "";
const gitLine = buildGitLine();

// Include useBar/compact in cache key so toggling options doesn't serve wrong-format cache
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
    const out = formatStatus(detail, serverNowMs, useBar, hide7dBelow70, compact);
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
