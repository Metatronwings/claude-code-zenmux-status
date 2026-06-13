import type { SubscriptionDetail, QuotaWindow } from "./api.js";
import { pctColor } from "./utils.js";

export type DisplayMode = "full" | "bar" | "compact";

const STATUS_BADGE: Record<string, string> = {
  monitored: " [monitored]",
  abusive:   " [abusive]",
  suspended: " [suspended]",
  banned:    " [banned]",
};

const TIER_EMOJI: Record<string, string> = {
  ultra: "💎",
  max:   "🔥",
  pro:   "⭐",
  free:  "🌱",
};

const BAR_WIDTH = 10;

function renderGradientBar(rate: number): string {
  const clamped = Math.max(0, Math.min(1, rate));
  const pos = clamped * BAR_WIDTH;
  const full = Math.floor(pos);
  const frac = pos - full;

  let bar = "█".repeat(full);
  if (full < BAR_WIDTH) {
    if (frac >= 0.75)      bar += "▓";
    else if (frac >= 0.50) bar += "▒";
    else if (frac >= 0.25) bar += "░";
    bar = bar.padEnd(BAR_WIDTH, "░");
  }

  return pctColor(rate) + bar + "\x1b[0m";
}

/**
 * Format a subscription detail into a status-line string.
 *
 * @param mode  "full" = tier + dollar amounts + countdowns;
 *              "bar"  = tier + gradient bars + percentages;
 *              "compact" = minimal, no bars, short labels
 */
export function formatStatus(
  detail: SubscriptionDetail,
  serverNowMs: number,
  mode: DisplayMode = "full",
  hide7dBelow70 = false
): string {
  const { plan, account_status, quota_7_day, quota_5_hour } = detail;
  const badge = STATUS_BADGE[account_status] ?? "";
  const emoji = TIER_EMOJI[plan.tier] ?? "⚡";
  const show7d = !hide7dBelow70 || quota_7_day.usage_percentage > 0.70;

  if (mode === "compact") {
    const parts: string[] = [
      `${emoji} 5h:${pct(quota_5_hour.usage_percentage)} ${resetStr(quota_5_hour, serverNowMs)}`,
    ];
    if (show7d) {
      parts.push(`7d:${pct(quota_7_day.usage_percentage)} ${resetStr(quota_7_day, serverNowMs)}`);
    }
    if (badge) parts.unshift(badge.trim());
    return parts.join(" | ");
  }

  if (mode === "bar") {
    const parts: string[] = [
      `${emoji} ${renderGradientBar(quota_5_hour.usage_percentage)} ${pct(quota_5_hour.usage_percentage)} ${resetStr(quota_5_hour, serverNowMs)}`.trimEnd(),
    ];
    if (show7d) {
      parts.push(`7d ${renderGradientBar(quota_7_day.usage_percentage)} ${pct(quota_7_day.usage_percentage)} ${resetStr(quota_7_day, serverNowMs)}`.trimEnd());
    }
    if (badge) parts.unshift(badge.trim());
    return parts.join(" | ");
  }

  // Full mode: tier + dollar amounts + countdowns
  const parts: string[] = [
    `${emoji} ${plan.tier}${badge}`,
    formatWindow("5h", quota_5_hour, serverNowMs),
  ];
  if (show7d) {
    parts.push(formatWindow("7d", quota_7_day, serverNowMs));
  }
  return parts.join(" | ");
}

function resetStr(q: QuotaWindow, nowMs: number): string {
  if (q.resets_at === null) return "(inactive)";
  const left = timeUntil(parseUTC(q.resets_at), nowMs);
  return left !== null ? `↻${left}` : "↻?";
}

function formatWindow(label: string, q: QuotaWindow, nowMs: number): string {
  const usagePct = pct(q.usage_percentage);
  const dollars = `$${q.used_value_usd?.toFixed(2) ?? "?"}/$${q.max_value_usd?.toFixed(2) ?? "?"}`;

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

function parseUTC(iso: string): number {
  const hasOffset = iso.endsWith("Z") || /[+-]\d\d:\d\d$/.test(iso);
  return new Date(hasOffset ? iso : iso + "Z").getTime();
}

function timeUntil(epochMs: number, nowMs: number): string | null {
  const ms = epochMs - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return formatDuration(ms);
}

export function formatDuration(ms: number, showSeconds = false): string {
  if (ms < 60_000) return showSeconds ? `${Math.floor(ms / 1000)}s` : "<1m";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
