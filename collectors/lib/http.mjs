// Shared HTTP helper with timeout + retry for all collectors.
export async function fetchJson(url, { timeoutMs = 20000, retries = 3, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": "jobs-dashboard-collector/1.0", Accept: "application/json", ...headers },
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        if (res.status === 404 || res.status === 401 || res.status === 403) break;
      } else {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch (e) {
          lastErr = new Error(`Invalid JSON from ${url}: ${text.slice(0, 120)}`);
        }
      }
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw lastErr || new Error(`Failed to fetch ${url}`);
}
