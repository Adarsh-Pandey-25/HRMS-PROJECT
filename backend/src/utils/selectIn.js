/**
 * Rows of a table whose column is one of many values, fetched a batch at a
 * time: a single IN filter with hundreds of ids can pass the request's URL
 * length limit. Returns { data, error } like a single query.
 * options: a batch size, or { batchSize, filter } where filter(query) adds
 * the query's other filters (applied to every batch).
 */
const selectIn = async (supabase, table, columns, column, values, options = 100) => {
  const { batchSize = 100, filter = null } = typeof options === 'number' ? { batchSize: options } : (options || {});
  const list = [...new Set((values || []).map(String))];
  const data = [];
  for (let i = 0; i < list.length; i += batchSize) {
    const query = supabase.from(table).select(columns).in(column, list.slice(i, i + batchSize));
    // eslint-disable-next-line no-await-in-loop
    const { data: rows, error } = await (filter ? filter(query) : query);
    if (error) return { data: null, error };
    data.push(...(rows || []));
  }
  return { data, error: null };
};

/**
 * Every row a query matches, a page at a time. PostgREST returns at most
 * about 1,000 rows per request (Supabase's default), so a single select
 * silently drops the rest for a big company. build() makes the query afresh
 * for each page, filters included; pages are ordered by `order` (default
 * 'id') so none overlap or are skipped. Returns { data, error } like a
 * single query.
 */
const selectAllPages = async (build, { pageSize = 1000, order = 'id' } = {}) => {
  const data = [];
  // 1,000 pages of 1,000 rows: far beyond any company; only a safety stop.
  for (let page = 0; page < 1000; page += 1) {
    let query = build();
    if (order) query = query.order(order, { ascending: true });
    // eslint-disable-next-line no-await-in-loop
    const { data: rows, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) return { data: null, error };
    data.push(...(rows || []));
    if (!rows || rows.length < pageSize) break;
  }
  return { data, error: null };
};

module.exports = { selectIn, selectAllPages };
