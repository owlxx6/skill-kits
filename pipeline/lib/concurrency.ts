// Runs work(item) for every item, at most `limit` at a time. Resolves once all are done; the
// work function must handle its own errors (a throw rejects the whole call). Items are taken
// in order, so with a limit of 1 this is a plain sequential loop.
export async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) await work(items[index]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}
