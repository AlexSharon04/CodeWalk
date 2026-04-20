export type FetchFn = typeof fetch;

export async function isOllamaReachable(
  baseUrl: string,
  timeoutMs = 1000,
  fetchImpl: FetchFn = fetch,
): Promise<boolean> {
  const rootUrl = baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const tagsUrl = `${rootUrl}/api/tags`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(tagsUrl, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
