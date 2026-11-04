/** selectIn: a long IN list a batch at a time, with the query's other filters on every batch. */
const { selectIn } = require('../../src/utils/selectIn');

const fakeSupabase = (calls) => ({
  from: (table) => {
    const call = { table, filters: [] };
    calls.push(call);
    const q = {
      select: (cols) => { call.columns = cols; return q; },
      in: (col, vals) => { call.filters.push(['in', col, vals]); return q; },
      eq: (col, val) => { call.filters.push(['eq', col, val]); return q; },
      then: (resolve, reject) => Promise.resolve(call.fail
        ? { data: null, error: { message: 'boom' } }
        : { data: call.filters[0][2].map((id) => ({ id })), error: null }).then(resolve, reject),
    };
    return q;
  },
});

test('250 ids: three batches, each with the other filters; duplicates asked for once', async () => {
  const calls = [];
  const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
  const { data, error } = await selectIn(fakeSupabase(calls), 'leaves', 'employee_id', 'employee_id', [...ids, 'id-0'], {
    filter: (q) => q.eq('status', 'pending'),
  });
  expect(error).toBeNull();
  expect(data).toHaveLength(250);
  expect(calls.map((c) => c.filters[0][2].length)).toEqual([100, 100, 50]);
  for (const c of calls) expect(c.filters[1]).toEqual(['eq', 'status', 'pending']);
});

test('a batch size as the last argument still works; an error stops at once', async () => {
  const calls = [];
  const sb = fakeSupabase(calls);
  const { data } = await selectIn(sb, 'employees', 'id', 'id', ['a', 'b', 'c'], 2);
  expect(data).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  expect(calls).toHaveLength(2);
  const failing = { from: (t) => { const s = fakeSupabase([]).from(t); s.then = (r) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(r); return s; } };
  expect(await selectIn(failing, 'employees', 'id', 'id', ['a'])).toEqual({ data: null, error: { message: 'boom' } });
  expect(await selectIn(sb, 'employees', 'id', 'id', [])).toEqual({ data: [], error: null });
});
