/**
 * Shared by the employee-*.test.js files: an in-memory stand-in for the
 * Supabase client, enough of it for employee.controller.js, and a way to
 * call a controller handler. Nothing here touches a database.
 *
 * Like Postgres, the stand-in matches uuids whatever their letter case —
 * which is exactly what made the capitalised-id bypass (audit #4) possible.
 */

const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sameValue = (a, b) => {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  const x = String(a);
  const y = String(b);
  return UUIDISH.test(x) && UUIDISH.test(y) ? x.toLowerCase() === y.toLowerCase() : x === y;
};

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function createFakeDb() {
  const tables = {};
  const table = (name) => {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  };

  class Query {
    constructor(name) {
      this.name = name;
      this.filters = [];
      this.op = 'select';
      this.payload = null;
      this.options = {};
      this.mode = 'many';
    }

    select(_columns, options = {}) {
      if (this.op === 'select') this.options = options;
      return this;
    }

    eq(column, value) { this.filters.push((r) => sameValue(r[column], value)); return this; }

    neq(column, value) { this.filters.push((r) => !sameValue(r[column], value)); return this; }

    in(column, values) { this.filters.push((r) => (values || []).some((v) => sameValue(r[column], v))); return this; }

    order() { return this; }

    range() { return this; }

    limit() { return this; }

    update(patch) { this.op = 'update'; this.payload = clone(patch); return this; }

    insert(rows) { this.op = 'insert'; this.payload = clone(rows); return this; }

    delete() { this.op = 'delete'; return this; }

    maybeSingle() { this.mode = 'maybe'; return this.run(); }

    single() { this.mode = 'one'; return this.run(); }

    then(resolve, reject) { return this.run().then(resolve, reject); }

    async run() {
      const rows = table(this.name);
      const matches = () => rows.filter((r) => this.filters.every((f) => f(r)));
      let out = [];
      if (this.op === 'select') {
        out = matches();
        if (this.options.head) return { data: null, count: out.length, error: null };
      } else if (this.op === 'update') {
        out = matches();
        out.forEach((r) => Object.assign(r, clone(this.payload)));
      } else if (this.op === 'insert') {
        out = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r) => ({ ...r }));
        out.forEach((r) => {
          if (!r.id) r.id = `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}`;
          rows.push(r);
        });
      } else if (this.op === 'delete') {
        out = matches();
        out.forEach((r) => rows.splice(rows.indexOf(r), 1));
      }
      const data = out.map(clone);
      if (this.mode === 'maybe') return { data: data[0] || null, error: null };
      if (this.mode === 'one') {
        return data.length === 1
          ? { data: data[0], error: null }
          : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
      }
      return { data, count: data.length, error: null };
    }
  }

  return {
    tables,
    table,
    reset() { Object.keys(tables).forEach((k) => delete tables[k]); },
    row(name, id) { return table(name).find((r) => sameValue(r.id, id)); },
    client: { from: (name) => new Query(name) },
  };
}

/** Call an Express handler; resolves with the response and/or the error passed to next(). */
async function call(handler, { user, params = {}, body = {}, file } = {}) {
  const req = { user, params, body, file, query: {}, ip: '127.0.0.1' };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  let error = null;
  await handler(req, res, (err) => { error = err || null; });
  return { req, res, error };
}

module.exports = { createFakeDb, call, sameValue };
