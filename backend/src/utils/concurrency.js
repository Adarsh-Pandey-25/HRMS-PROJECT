/**
 * Run `worker` over `items` with at most `limit` running at once, in order.
 * Resolves when all are done; a failing item is reported to `onError` and
 * does not stop the rest. Used for mailing a list of people without a burst.
 */
const forEachWithLimit = async (items, limit, worker, onError = () => {}) => {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      try { await worker(item); } catch (err) { onError(err, item); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, lane));
};

module.exports = { forEachWithLimit };
