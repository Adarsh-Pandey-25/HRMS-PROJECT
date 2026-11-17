// Smoke test: the whole Express app (every route file and middleware) loads,
// with the database and .env stubbed. Catches a missing export or a bad merge
// that would otherwise crash the server on start.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const builder = () => {
    const b = {};
    for (const m of ['from', 'select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'is',
      'gte', 'lte', 'gt', 'lt', 'order', 'limit', 'range', 'single', 'maybeSingle', 'match', 'or', 'not', 'ilike', 'rpc']) {
      b[m] = () => b;
    }
    b.then = (resolve) => resolve({ data: null, error: null, count: 0 });
    return b;
  };
  const client = { from: () => builder(), rpc: () => builder(), storage: { from: () => builder() }, auth: {} };
  return { supabaseAdmin: client, supabase: client };
});

jest.useFakeTimers();

test('app module loads and exports an Express app', () => {
  const app = require('../../src/app');
  expect(typeof app).toBe('function');
  expect(typeof app.use).toBe('function');
});
