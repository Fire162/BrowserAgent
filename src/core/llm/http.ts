/**
 * Resilient HTTP client with automatic 429 Rate-Limit handling & exponential backoff
 */

export interface FetchWithRetryOptions extends RequestInit {
  maxRetries?: number;
  initialDelayMs?: number;
  onRetryNotice?: (message: string) => void;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;

  // Try parsing as integer seconds
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // Try parsing as HTTP date
  const date = Date.parse(header);
  if (!isNaN(date)) {
    const diff = date - Date.now();
    return diff > 0 ? diff : 1000;
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    initialDelayMs = 2000,
    onRetryNotice,
    ...fetchInit
  } = options;

  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const res = await fetch(url, fetchInit);

      // Check for rate limit (429) or transient server overload (503 / 529)
      if (res.status === 429 || res.status === 503 || res.status === 529) {
        attempt++;

        if (attempt > maxRetries) {
          const errBody = await res.text();
          throw new Error(
            `Rate limit (429) exceeded after ${maxRetries} retries on ${new URL(url).hostname}. Server response: ${errBody.slice(0, 200)}`
          );
        }

        // Determine wait time from Retry-After header or exponential backoff
        const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
        const jitter = Math.random() * 800;
        const backoffMs = initialDelayMs * Math.pow(2, attempt - 1) + jitter;
        const delayMs = Math.min(30000, retryAfterMs !== null ? retryAfterMs : backoffMs);

        const waitSecs = (delayMs / 1000).toFixed(1);
        const noticeMsg = `Rate limit (429) received. Pausing ${waitSecs}s before retry (${attempt}/${maxRetries})...`;
        console.warn(`[BrowserAgent HTTP] ${noticeMsg}`);
        onRetryNotice?.(noticeMsg);

        await sleep(delayMs);
        continue;
      }

      return res;
    } catch (err: any) {
      // If network failure or rate limit error after retries
      if (attempt >= maxRetries || err.message.includes('exceeded after')) {
        throw err;
      }

      attempt++;
      const delayMs = initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
      onRetryNotice?.(`Network glitch. Retrying in ${(delayMs / 1000).toFixed(1)}s (${attempt}/${maxRetries})...`);
      await sleep(delayMs);
    }
  }

  throw new Error(`Failed to complete request after ${maxRetries} attempts.`);
}
