/**
 * 供应商 HTTP 请求：把 proxy 传给运行时 fetch。
 *
 * Aluka 的 fetch 读取 init.proxy（http / https / socks5）。
 * Node 自带 fetch 会忽略该字段。
 */

export type ProviderFetchInit = RequestInit & { proxy?: string };

export function withProxy(init: RequestInit, proxy?: string): ProviderFetchInit {
  const value = proxy?.trim();
  if (!value) return init;
  return { ...init, proxy: value };
}

export function providerFetch(
  url: string,
  init: RequestInit = {},
  proxy?: string,
): Promise<Response> {
  return fetch(url, withProxy(init, proxy));
}
