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

module.exports = { selectIn };
