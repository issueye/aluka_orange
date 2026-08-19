/**
 * 可选更新检查：读取 GitHub Releases API JSON（或兼容 { tag_name, html_url } 的自定义 URL）。
 * 未配置 URL 时返回 skipped，不访问网络。
 */

export interface UpdateCheckResult {
  current: string;
  skipped?: boolean;
  reason?: string;
  latest?: string;
  url?: string;
  upToDate?: boolean;
  error?: string;
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^v/i, "");
}

function compareSemverLike(a: string, b: string): number {
  const pa = normalizeTag(a).split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = normalizeTag(b).split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function resolveUpdateCheckUrl(explicit?: string): string | undefined {
  const fromArg = explicit?.trim();
  if (fromArg) return fromArg;
  const fromEnv = process.env.ALUKA_DESKTOP_RELEASES_URL?.trim();
  return fromEnv || undefined;
}

/** 纯函数：把 Releases JSON 解析成结果（便于单测） */
export function parseReleasePayload(current: string, payload: unknown): UpdateCheckResult {
  if (!payload || typeof payload !== "object") {
    return { current, error: "invalid release payload" };
  }
  const row = payload as Record<string, unknown>;
  const tag = typeof row.tag_name === "string" ? row.tag_name : typeof row.version === "string" ? row.version : "";
  if (!tag) return { current, error: "release JSON missing tag_name/version" };
  const latest = normalizeTag(tag);
  const url = typeof row.html_url === "string" ? row.html_url : typeof row.url === "string" ? row.url : undefined;
  const cmp = compareSemverLike(latest, current);
  return {
    current: normalizeTag(current),
    latest,
    url,
    upToDate: cmp <= 0,
  };
}

export async function checkForDesktopUpdate(opts: {
  currentVersion: string;
  url?: string;
  fetchImpl?: typeof fetch;
}): Promise<UpdateCheckResult> {
  const current = opts.currentVersion;
  const url = resolveUpdateCheckUrl(opts.url);
  if (!url) {
    return {
      current,
      skipped: true,
      reason: "Set ALUKA_DESKTOP_RELEASES_URL to a GitHub releases/latest JSON endpoint",
    };
  }
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    return { current, error: "fetch is not available in this runtime" };
  }
  try {
    const res = await fetchFn(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "AlukaDesktop" },
    });
    if (!res.ok) {
      return { current, error: `HTTP ${res.status}` };
    }
    const json: unknown = await res.json();
    return parseReleasePayload(current, json);
  } catch (error) {
    return { current, error: error instanceof Error ? error.message : String(error) };
  }
}
