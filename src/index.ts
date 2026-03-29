import { fetchDetail } from "./api.js";
import { formatStatus } from "./format.js";
import { readCache, writeCache } from "./cache.js";

const apiKey = process.env.ZENMUX_MANAGEMENT_API_KEY;

if (!apiKey) {
  process.stderr.write("ZENMUX_MANAGEMENT_API_KEY must be set\n");
  process.exit(1);
}

const ttlMs = Number(process.env.ZENMUX_CACHE_TTL ?? 60) * 1000;

const cached = readCache(apiKey, ttlMs);
if (cached !== null) {
  process.stdout.write(cached + "\n");
  process.exit(0);
}

try {
  const { detail, serverNowMs } = await fetchDetail(apiKey);
  const out = formatStatus(detail, serverNowMs);
  writeCache(apiKey, out);
  process.stdout.write(out + "\n");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stdout.write(`⚡ ERR: ${msg}\n`);
  process.exit(0);
}
