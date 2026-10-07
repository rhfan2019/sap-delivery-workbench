/** Ignore reads that complete after their project, item or page context has changed. */
export async function scopedRequest<T>(
  readScope: () => string,
  request: () => Promise<T>,
  apply: (value: T) => void,
  fail: (error: unknown) => void,
) {
  const scope = readScope();
  try {
    const result = await request();
    if (scope === readScope()) apply(result);
  } catch (error) {
    if (scope === readScope()) fail(error);
  }
}
