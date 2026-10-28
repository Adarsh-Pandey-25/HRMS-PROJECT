/**
 * A tiny in-memory stand-in for the parts of supabase-js the WhatsApp code
 * uses, so tests never touch a real database. Unique keys mirror the
 * migration (20261028_whatsapp_channel.sql).
 */

const UNIQUE = {
  whatsapp_inbound: [['wa_message_id']],
  whatsapp_messages: [['dedupe_key'], ['wa_message_id']],
  whatsapp_links: [['subject_type', 'subject_id']],
  whatsapp_link_codes: [['code_hash']],
  company_whatsapp_settings: [['company_id']],
  platform_whatsapp_state: [['environment']],
};

const makeFakeSupabase = (initial = {}, { rpc = {} } = {}) => {
  const tables = {};
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((r) => ({ ...r }));
  const calls = [];
  let nextId = 1;

  const conflicts = (table, row, keySets) => (tables[table] || []).find((existing) => keySets.some((keys) => keys.every(
    (k) => row[k] !== undefined && row[k] !== null && existing[k] === row[k],
  )));

  class Query {
    constructor(table) {
      this.table = table;
      this.op = 'select';
      this.filters = [];
      this.payload = null;
      this.options = {};
      this.countMode = null;
      this.head = false;
      this.returning = false;
      this.singleMode = null;
      this.limitN = null;
    }

    select(_cols, opts = {}) {
      if (this.op === 'select') {
        this.countMode = opts.count || null;
        this.head = Boolean(opts.head);
      } else {
        this.returning = true;
      }
      return this;
    }

    insert(rows) { this.op = 'insert'; this.payload = [].concat(rows); return this; }

    upsert(rows, options = {}) { this.op = 'upsert'; this.payload = [].concat(rows); this.options = options; return this; }

    update(values) { this.op = 'update'; this.payload = values; return this; }

    delete() { this.op = 'delete'; return this; }

    eq(col, val) { this.filters.push((r) => r[col] === val); return this; }

    neq(col, val) { this.filters.push((r) => r[col] !== val); return this; }

    in(col, vals) { this.filters.push((r) => vals.includes(r[col])); return this; }

    is(col, val) { this.filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val)); return this; }

    gt(col, val) { this.filters.push((r) => r[col] > val); return this; }

    gte(col, val) { this.filters.push((r) => r[col] >= val); return this; }

    lt(col, val) { this.filters.push((r) => r[col] < val); return this; }

    lte(col, val) { this.filters.push((r) => r[col] <= val); return this; }

    ilike(col, val) { this.filters.push((r) => String(r[col] || '').toLowerCase() === String(val).toLowerCase()); return this; }

    or(expression) {
      const parts = String(expression).split(',').map((p) => {
        const [col, , ...rest] = p.split('.');
        return [col, rest.join('.')];
      });
      this.filters.push((r) => parts.some(([col, val]) => String(r[col]) === val));
      return this;
    }

    order() { return this; }

    limit(n) { this.limitN = n; return this; }

    range() { return this; }

    maybeSingle() { this.singleMode = 'maybe'; return this; }

    single() { this.singleMode = 'one'; return this; }

    then(resolve, reject) {
      try {
        resolve(this.run());
      } catch (err) {
        reject(err);
      }
    }

    run() {
      calls.push({ table: this.table, op: this.op, payload: this.payload, options: this.options });
      if (!tables[this.table]) tables[this.table] = [];
      const rows = tables[this.table];
      const matches = () => rows.filter((r) => this.filters.every((f) => f(r)));
      const keySets = UNIQUE[this.table] || [];
      const shape = (list) => {
        if (this.singleMode) {
          if (this.singleMode === 'one' && list.length !== 1) return { data: null, error: { message: 'not exactly one row' } };
          return { data: list[0] || null, error: null };
        }
        return { data: list, error: null, count: list.length };
      };

      if (this.op === 'select') {
        let list = matches();
        if (this.limitN) list = list.slice(0, this.limitN);
        if (this.head) return { data: null, error: null, count: list.length };
        return shape(list.map((r) => ({ ...r })));
      }
      if (this.op === 'insert') {
        const added = [];
        for (const row of this.payload) {
          if (conflicts(this.table, row, keySets)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          const stored = { id: row.id || `id-${nextId++}`, ...row };
          rows.push(stored);
          added.push({ ...stored });
        }
        return this.returning ? shape(added) : { data: null, error: null };
      }
      if (this.op === 'upsert') {
        const conflictKeys = this.options.onConflict ? [String(this.options.onConflict).split(',')] : keySets;
        const written = [];
        for (const row of this.payload) {
          const existing = conflicts(this.table, row, conflictKeys);
          if (existing) {
            if (this.options.ignoreDuplicates) continue;
            Object.assign(existing, row);
            written.push({ ...existing });
          } else {
            const stored = { id: row.id || `id-${nextId++}`, ...row };
            rows.push(stored);
            written.push({ ...stored });
          }
        }
        return this.returning ? shape(written) : { data: null, error: null };
      }
      if (this.op === 'update') {
        const hit = matches();
        for (const r of hit) Object.assign(r, this.payload);
        return this.returning ? shape(hit.map((r) => ({ ...r }))) : { data: null, error: null };
      }
      if (this.op === 'delete') {
        const keep = rows.filter((r) => !this.filters.every((f) => f(r)));
        tables[this.table] = keep;
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
  }

  return {
    tables,
    calls,
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      calls.push({ rpc: name, args });
      return rpc[name] ? rpc[name](args, tables) : { data: [], error: null };
    },
  };
};

module.exports = { makeFakeSupabase };
