export const NETWORK_TIMEOUT_MS = 60_000;

/** Abort the underlying request as well as stop waiting for it. Callers must
 * pass the signal to network/stream operations; a race alone cannot cancel writes. */
export const withDeadline = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  label: string,
  timeoutMs = NETWORK_TIMEOUT_MS,
): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    clearTimeout(timer!);
  }
};
