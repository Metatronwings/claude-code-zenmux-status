const API_URL = "https://zenmux.ai/api/v1/management/subscription/detail";

export interface QuotaWindow {
  usage_percentage: number;   // 0–1
  resets_at: string | null;   // UTC ISO 8601
  max_flows: number;
  used_flows: number;
  remaining_flows: number;
  used_value_usd: number;
  max_value_usd: number;
}

export interface QuotaMonthly {
  max_flows: number;
  max_value_usd: number;
}

export interface SubscriptionDetail {
  plan: {
    tier: string;           // "free" | "pro" | "max" | "ultra"
    amount_usd: number;
    interval: string;
    expires_at: string;
  };
  currency: string;
  base_usd_per_flow: number;
  effective_usd_per_flow: number;
  account_status: string;   // "healthy" | "monitored" | "abusive" | "suspended" | "banned"
  quota_5_hour: QuotaWindow;
  quota_7_day: QuotaWindow;
  quota_monthly: QuotaMonthly;
}

export interface FetchResult {
  detail: SubscriptionDetail;
  /**
   * UTC epoch (ms) from the HTTP `Date` response header.
   * Used as the "now" reference for all countdown calculations so that
   * local system clock errors don't affect the display.
   */
  serverNowMs: number;
}

interface ApiResponse {
  success: boolean;
  message?: string;
  data: SubscriptionDetail | null;
}

export async function fetchDetail(apiKey: string): Promise<FetchResult> {
  const res = await fetch(API_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const json = (await res.json()) as ApiResponse;

  if (!json.success || !json.data) {
    throw new Error(json.message ?? "API returned no data");
  }

  const dateHeader = res.headers.get("date");
  const serverNowMs = dateHeader ? new Date(dateHeader).getTime() : Date.now();

  return { detail: json.data, serverNowMs };
}
