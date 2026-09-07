/**
 * Runs `fn` over `items` with at most `limit` in flight at once, instead of
 * `Promise.all(items.map(fn))` firing every call simultaneously. A report
 * that fans out N queries per item (e.g. 4 lookups per employee) turns an
 * unbounded scope (a whole company) into an unbounded burst of concurrent
 * DB queries — this caps that burst regardless of how large `items` is.
 */
const mapWithConcurrency = async (items, limit, fn) => {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

module.exports = { mapWithConcurrency };
