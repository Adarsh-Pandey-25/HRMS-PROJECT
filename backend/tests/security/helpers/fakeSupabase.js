/**
 * An in-memory stand-in for the Supabase query builder — just the calls the
 * attendance and biometric-device code makes (select / update / insert /
 * upsert / delete with eq / is / in filters). The security tests never touch
 * a real database: backend/.env points at production.
 *
 * `missingColumns` makes any select or write naming one of those columns
 * fail the way PostgREST does before a migration has run; `missingTables`
 * does the same for a whole table. `lt` filters like the database (a row
 * without the column never matches), and an upsert with `ignoreDuplicates`
 * skips rows that clash on its `onConflict` columns, as Postgres does.
 */
const makeFakeSupabase = (tables = {}, { missingColumns = [], missingTables = [] } = {}) => {
  const calls = [];

  const from = (table) => {
    const state = {
      op: 'select', filters: [], patch: null, rows: null, options: null, returning: false, single: false, maybe: false, columns: '',
    };
    const rowsOf = () => {
      if (!tables[table]) tables[table] = [];
      return tables[table];
    };
    const matches = (row) => state.filters.every(([kind, col, val]) => {
      if (kind === 'eq') return row[col] === val;
      if (kind === 'is') return (row[col] ?? null) === val;
      if (kind === 'in') return val.includes(row[col]);
      if (kind === 'lt') return row[col] != null && String(row[col]) < String(val);
      return true;
    });
    const missing = () => {
      const named = [state.columns, ...Object.keys(state.patch || {})].join(',');
      return missingColumns.find((c) => named.includes(c));
    };
    const shape = (list) => {
      if (state.maybe) return { data: list[0] ? { ...list[0] } : null, error: null };
      if (state.single) {
        return list.length === 1 ? { data: { ...list[0] }, error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
      }
      return { data: list.map((r) => ({ ...r })), error: null };
    };
    const run = () => {
      calls.push({ table, op: state.op, filters: state.filters, patch: state.patch, rows: state.rows });
      if (missingTables.includes(table)) {
        return { data: null, error: { message: `Could not find the table 'public.${table}' in the schema cache` } };
      }
      const col = missing();
      if (col) return { data: null, error: { message: `column ${table}.${col} does not exist` } };
      if (state.op === 'select') return shape(rowsOf().filter(matches));
      if (state.op === 'update') {
        const hit = rowsOf().filter(matches);
        hit.forEach((r) => Object.assign(r, state.patch));
        return state.returning ? shape(hit) : { data: null, error: null };
      }
      if (state.op === 'insert' || state.op === 'upsert') {
        let list = (Array.isArray(state.rows) ? state.rows : [state.rows]).map((r) => ({ ...r }));
        const conflictColumns = state.op === 'upsert' && state.options?.ignoreDuplicates && state.options.onConflict
          ? String(state.options.onConflict).split(',').map((c) => c.trim())
          : null;
        if (conflictColumns) {
          const clashes = (a, b) => conflictColumns.every((c) => String(a[c]) === String(b[c]));
          list = list.filter((r, i) => !rowsOf().some((existing) => clashes(existing, r)) && !list.slice(0, i).some((earlier) => clashes(earlier, r)));
        }
        rowsOf().push(...list);
        return state.returning ? shape(list) : { data: null, error: null };
      }
      if (state.op === 'delete') {
        const keep = rowsOf().filter((r) => !matches(r));
        tables[table] = keep;
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };

    const q = {
      select(columns = '*') {
        if (state.op === 'select') state.columns = columns;
        else state.returning = true;
        return q;
      },
      update(patch) { state.op = 'update'; state.patch = patch; return q; },
      insert(rows) { state.op = 'insert'; state.rows = rows; return q; },
      upsert(rows, options = null) { state.op = 'upsert'; state.rows = rows; state.options = options; return q; },
      delete() { state.op = 'delete'; return q; },
      eq(col, val) { state.filters.push(['eq', col, val]); return q; },
      is(col, val) { state.filters.push(['is', col, val]); return q; },
      in(col, val) { state.filters.push(['in', col, val]); return q; },
      gte() { return q; },
      lte() { return q; },
      lt(col, val) { state.filters.push(['lt', col, val]); return q; },
      order() { return q; },
      limit() { return q; },
      maybeSingle() { state.maybe = true; return q; },
      single() { state.single = true; return q; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    return q;
  };

  return { from, calls, tables };
};

module.exports = { makeFakeSupabase };
