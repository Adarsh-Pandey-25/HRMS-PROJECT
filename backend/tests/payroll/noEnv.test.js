/**
 * The payroll tests never load backend/.env (the live database's keys):
 * dotenv is stubbed, so the database settings stay empty. Nothing is printed.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: () => { throw new Error('no database in these tests'); } } }));

test('loading the payroll service reads no database keys', () => {
  require('../../src/services/payroll.service');
  expect(process.env.SUPABASE_URL).toBeUndefined();
  expect(process.env.SUPABASE_SERVICE_KEY).toBeUndefined();
});
