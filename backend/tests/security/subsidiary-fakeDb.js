/**
 * In-memory stand-in for the Supabase client, for the subsidiary billing
 * tests: eq/neq/in filters, order, limit, maybeSingle/single, head counts,
 * insert/update/upsert/delete, and the subscriptions → plans join. Nothing
 * here reaches a database. Load it from a jest.mock factory:
 *   jest.mock('../../src/config/supabase', () => require('./subsidiary-fakeDb'));
 */
const db = { tables: {} };

/** Replace every table with a deep copy of `tables`. */
const reset = (tables = {}) => {
  db.tables = JSON.parse(JSON.stringify(tables));
};

const make = (table) => {
  const state = {
    op: 'select', filters: [], order: null, limit: null, head: false, columns: '*', payload: null, onConflict: null,
  };
  const rows = () => {
    if (!db.tables[table]) db.tables[table] = [];
    return db.tables[table];
  };
  const match = (r) => state.filters.every((f) => f(r));
  const withJoins = (r) => {
    if (table === 'company_billing_subscriptions' && /plans:subscription_plans/.test(state.columns)) {
      return { ...r, plans: (db.tables.subscription_plans || []).find((p) => p.id === r.plan_id) || null };
    }
    return { ...r };
  };

  const run = () => {
    if (state.op === 'insert') {
      const list = Array.isArray(state.payload) ? state.payload : [state.payload];
      const made = list.map((p, i) => ({ id: `${table}-${rows().length + i + 1}`, ...p }));
      rows().push(...made);
      return { data: made.map(withJoins), error: null };
    }
    if (state.op === 'upsert') {
      const keys = String(state.onConflict || 'id').split(',');
      let row = rows().find((r) => keys.every((k) => String(r[k]) === String(state.payload[k])));
      if (row) Object.assign(row, state.payload);
      else {
        row = { id: `${table}-${rows().length + 1}`, ...state.payload };
        rows().push(row);
      }
      return { data: [withJoins(row)], error: null };
    }
    if (state.op === 'update') {
      const hit = rows().filter(match);
      hit.forEach((r) => Object.assign(r, state.payload));
      return { data: hit.map(withJoins), error: null };
    }
    if (state.op === 'delete') {
      const keep = rows().filter((r) => !match(r));
      db.tables[table] = keep;
      return { data: null, error: null };
    }
    let out = rows().filter(match);
    if (state.order) {
      const [col, asc] = state.order;
      out = [...out].sort((a, b) => {
        if (a[col] === b[col]) return 0;
        return (a[col] < b[col] ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    if (state.limit != null) out = out.slice(0, state.limit);
    if (state.head) return { data: null, count: out.length, error: null };
    return { data: out.map(withJoins), count: out.length, error: null };
  };

  const q = {
    select(columns = '*', opts = {}) {
      if (state.op === 'select') {
        state.columns = columns;
        state.head = Boolean(opts.head);
      }
      return q;
    },
    eq(col, v) { state.filters.push((r) => String(r[col]) === String(v)); return q; },
    neq(col, v) { state.filters.push((r) => String(r[col]) !== String(v)); return q; },
    in(col, values) {
      const set = (values || []).map(String);
      state.filters.push((r) => r[col] != null && set.includes(String(r[col])));
      return q;
    },
    order(col, { ascending = true } = {}) { state.order = [col, ascending]; return q; },
    limit(n) { state.limit = n; return q; },
    insert(p) { state.op = 'insert'; state.payload = p; return q; },
    update(p) { state.op = 'update'; state.payload = p; return q; },
    upsert(p, { onConflict } = {}) { state.op = 'upsert'; state.payload = p; state.onConflict = onConflict; return q; },
    delete() { state.op = 'delete'; return q; },
    maybeSingle() {
      const r = run();
      return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error });
    },
    then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
  };
  q.single = q.maybeSingle;
  return q;
};

module.exports = { supabaseAdmin: { from: (t) => make(t) }, db, reset };
