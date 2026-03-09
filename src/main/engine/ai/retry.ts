/**
 * Retry helper with exponential backoff for AI API calls.
 *
 * Delays: baseDelayMs * 2^attempt (e.g. 5s, 10s, 20s for base=5000).
 */

export interface RetryOptions {
  /** Maximum number of retries after the initial attempt (default: 3). */
  maxRetries?: number;
  /** Base delay in ms before the first retry (default: 5000). Doubles each retry. */
  baseDelayMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function retryWithBackoff<T extends { success: boolean }>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 5000;

  let result = await fn();

  for (let attempt = 0; attempt < maxRetries && !result.success; attempt++) {
    const delay = baseDelayMs * Math.pow(2, attempt);
    await sleep(delay);
    result = await fn();
  }

  return result;
}
