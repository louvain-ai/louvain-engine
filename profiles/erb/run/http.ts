/**
 * One JSON request to a model provider, retried as the scored harness's SDK retried: twice, with backoff, on a 408,
 * 409, 429 or 5xx. Any other failure, or a third, is thrown with the start of what the provider said.
 */
const RETRIES = 2;

/** Where a request goes, with what headers, carrying what body (sent as JSON). */
export type JsonRequest = { url: string; headers: Record<string, string>; body: unknown };

export async function postJson(
  { url, headers, body }: JsonRequest,
  signal: AbortSignal,
): Promise<unknown> {
  const text = JSON.stringify(body);
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: text,
      signal,
    });
    if (res.ok) return res.json();
    const said = await res.text();
    if (attempt >= RETRIES || !(res.status >= 500 || [408, 409, 429].includes(res.status)))
      throw new Error(`${res.status} ${said.slice(0, 300)}`);
    await sleep(delayOf(res.headers.get("retry-after"), attempt), signal);
  }
}

/** The server's `retry-after` when it gives a sane one, else half a second doubling, at most eight. */
function delayOf(retryAfter: string | null, attempt: number): number {
  const said = Number(retryAfter);
  return Number.isFinite(said) && said > 0 && said <= 60
    ? said * 1000
    : Math.min(8_000, 500 * 2 ** attempt);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((done, failed) => {
    const timer = setTimeout(done, ms);
    const stop = () => {
      clearTimeout(timer);
      failed(signal.reason);
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}
