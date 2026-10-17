/** Await native work without making application shutdown wait for an uncancellable API.
 * Late resource values must be released by their owner via `discard`.
 */
export function abortable<T>(
  work: Promise<T>,
  signal?: AbortSignal,
  discard?: (value: T) => void,
): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) {
          discard?.(value);
          reject(signal.reason);
        } else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export function requestSignal(owned: AbortSignal, caller?: AbortSignal): AbortSignal {
  return caller ? AbortSignal.any([owned, caller]) : owned;
}
