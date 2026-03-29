import type { SubscriptionDetail, QuotaWindow } from "./api.js";

const STATUS_BADGE: Record<string, string> = {
  monitored: " [monitored]",
  abusive:   " [abusive]",
  suspended: " [suspended]",
  banned:    " [banned]",
};

export function formatStatus(detail: SubscriptionDetail, serverNowMs: number): string {
  const { plan, account_status, quota_7_day, quota_5_hour } = detail;

  const badge = STATUS_BADGE[account_status] ?? "";
  const tier = `⚡ ${plan.tier}${badge}`;

  const parts = [
    tier,
    formatWindow("7d", quota_7_day, serverNowMs),
    formatWindow("5h", quota_5_hour, serverNowMs),
  ];

  return parts.join(" | ");
}

function formatWindow(label: string, q: QuotaWindow, nowMs: number): string {
  const usagePct = pct(q.usage_percentage);
  const dollars = `$${q.used_value_usd.toFixed(2)}/$${q.max_value_usd.toFixed(2)}`;

  if (q.resets_at === null) {
    return `${label} ${usagePct} ${dollars} (inactive)`;
  }

  const left = timeUntil(parseUTC(q.resets_at), nowMs);
  const reset = left !== null ? `↻${left}` : `↻?`;
  return `${label} ${usagePct} ${dollars} ${reset}`;
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Parse an ISO 8601 string as UTC milliseconds.
 * Appends 'Z' if the string has no timezone indicator to prevent
 * local-time misinterpretation across different system timezones.
 */
function parseUTC(iso: string): number {
  const hasOffset = iso.endsWith("Z") || /[+-]\d\d:\d\d$/.test(iso);
  return new Date(hasOffset ? iso : iso + "Z").getTime();
}

/** Time until a future UTC epoch. Uses serverNowMs to avoid local clock skew. */
function timeUntil(epochMs: number, nowMs: number): string | null {
  const ms = epochMs - nowMs;
  if (ms <= 0) return null;
  return formatDuration(ms);
}

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
