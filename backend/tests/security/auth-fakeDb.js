/**
 * A small in-memory stand-in for the Supabase query builder, enough for the
 * login/session code: select / insert / update / delete with eq, in, gt, lt,
 * is, or, order, limit, single and maybeSingle. Each statement runs in one go
 * (like one SQL statement), so a conditional update is a real
 * compare-and-set. Never touches a real database.
 */

const crypto = require('crypto');

/** Like SQL `=`: a missing value never equals anything (use `is` for nulls). */
const sameValue = (a, b) => {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
};

const compare = (a, b) => {
  if (typeof a === 'number' || typeof b === 'number') return Number(a) - Number(b);
  return new Date(a).getTime() - new Date(b).getTime();
};

/** PostgREST `or` filter: "col.is.null,col.lt.5" (the forms the code uses). */
const parseOr = (expr) => {
  const parts = String(expr).split(',').map((p) => p.split('.'));
  return (row) => parts.some(([col, op, value]) => {
    if (op === 'is' && value === 'null') return row[col] === null || row[col] === undefined;
    if (op === 'eq') return sameValue(row[col], value);
    if (row[col] === null || row[col] === undefined) return false;
    if (op === 'lt') return compare(row[col], Number(value)) < 0;
    if (op === 'gt') return compare(row[col], Number(value)) > 0;
    throw new Error(`fake db: unsupported or() operator ${op}`);
  });
};

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.op = 'select';
    this.filters = [];
    this.returning = false;
    this.mode = 'many';
    this.max = null;
  }

  select() {
    if (this.op !== 'select') this.returning = true;
    return this;
  }

  insert(rows) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }

  update(patch) { this.op = 'update'; this.payload = patch; return this; }

  delete() { this.op = 'delete'; return this; }

  eq(col, value) { this.filters.push((r) => sameValue(r[col], value)); return this; }

  in(col, values) { this.filters.push((r) => values.some((v) => sameValue(r[col], v))); return this; }

  gt(col, value) { this.filters.push((r) => r[col] != null && compare(r[col], value) > 0); return this; }

  lt(col, value) { this.filters.push((r) => r[col] != null && compare(r[col], value) < 0); return this; }

  is(col, value) {
    this.filters.push((r) => (value === null ? r[col] === null || r[col] === undefined : r[col] === value));
    return this;
  }

  or(expr) { this.filters.push(parseOr(expr)); return this; }

  order() { return this; }

  limit(n) { this.max = n; return this; }

  single() { this.mode = 'single'; return this; }

  maybeSingle() { this.mode = 'maybe'; return this; }

  then(resolve, reject) {
    let result;
    try {
      result = this.run();
    } catch (err) {
      return Promise.reject(err).then(resolve, reject);
    }
    // Resolve on a later tick, like a network round trip, so concurrent
    // callers really interleave between statements.
    return new Promise((r) => setImmediate(() => r(result))).then(resolve, reject);
  }

  run() {
    this.db.log.push({ table: this.table, op: this.op });
    const failure = this.db.failures[this.table];
    if (failure) return { data: null, error: { message: failure } };
    const rows = this.db.tables[this.table] || (this.db.tables[this.table] = []);
    const matches = rows.filter((r) => this.filters.every((f) => f(r)));
    let data;
    if (this.op === 'select') {
      data = matches.map((r) => ({ ...r }));
    } else if (this.op === 'insert') {
      // Every table here has an `id` default except the challenges (keyed by jti).
      const inserted = this.payload.map((r) => ({ ...(this.table === 'two_fa_login_challenges' ? {} : { id: crypto.randomUUID() }), ...r }));
      rows.push(...inserted);
      data = inserted.map((r) => ({ ...r }));
    } else if (this.op === 'update') {
      matches.forEach((r) => Object.assign(r, this.payload));
      data = matches.map((r) => ({ ...r }));
    } else {
      this.db.tables[this.table] = rows.filter((r) => !matches.includes(r));
      data = matches.map((r) => ({ ...r }));
    }
    if (this.max != null) data = data.slice(0, this.max);
    if (this.op !== 'select' && !this.returning && this.mode === 'many') return { data: null, error: null };
    if (this.mode === 'many') return { data, error: null };
    if (data.length > 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
    if (this.mode === 'single' && !data.length) {
      return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
    }
    return { data: data[0] || null, error: null };
  }
}

const createFakeDb = () => {
  const db = {
    tables: {},
    failures: {},
    log: [],
    reset(seed = {}) {
      db.tables = {};
      db.failures = {};
      db.log = [];
      for (const [table, rows] of Object.entries(seed)) db.tables[table] = rows.map((r) => ({ ...r }));
    },
    rows(table) { return db.tables[table] || []; },
    find(table, predicate) { return db.rows(table).find(predicate); },
  };
  db.client = { from: (table) => new Query(db, table) };
  return db;
};

module.exports = { createFakeDb };
