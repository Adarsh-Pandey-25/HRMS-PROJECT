/**
 * Audit #4: ids are compared the way Postgres compares them — whatever the
 * letter case. The route validators store a uuid lower-cased, and
 * utils/sameId.js is the comparison every "is this me?" check uses.
 */
const { validationResult } = require('express-validator');
const { employeeRefParam, uuidParam } = require('../../src/utils/validators');
const { sameId, normalizeId, isUuid } = require('../../src/utils/sameId');

const OWN_ID = '3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b';

const runChain = async (chains, value) => {
  const req = { params: { id: value } };
  for (const chain of chains) await chain.run(req);
  return { value: req.params.id, ok: validationResult(req).isEmpty() };
};

describe('sameId', () => {
  test('matches ids whatever their letter case', () => {
    expect(sameId(OWN_ID, OWN_ID.toUpperCase())).toBe(true);
    expect(sameId(` ${OWN_ID.toUpperCase()} `, OWN_ID)).toBe(true);
  });

  test('never matches a missing id, even against another missing id', () => {
    expect(sameId(undefined, undefined)).toBe(false);
    expect(sameId(null, '')).toBe(false);
    expect(sameId(OWN_ID, null)).toBe(false);
  });

  test('different ids stay different', () => {
    expect(sameId(OWN_ID, OWN_ID.replace(/b$/, 'c'))).toBe(false);
  });

  test('normalizeId and isUuid', () => {
    expect(normalizeId(OWN_ID.toUpperCase())).toBe(OWN_ID);
    expect(isUuid(OWN_ID.toUpperCase())).toBe(true);
    expect(isUuid('EMP001')).toBe(false);
  });
});

describe('employee id route parameter', () => {
  test('a capitalised uuid is accepted and stored lower-case', async () => {
    expect(await runChain(employeeRefParam(), OWN_ID.toUpperCase())).toEqual({ value: OWN_ID, ok: true });
  });

  test('an employee code is still accepted (GET /employees/:id looks people up by code) and left as typed', async () => {
    expect(await runChain(employeeRefParam(), 'EMP001')).toEqual({ value: 'EMP001', ok: true });
  });

  test.each([
    ['empty', ''],
    ['spaces inside', 'EMP 001'],
    ['query-like', "x' or '1'='1"],
    ['PostgREST filter syntax', 'eq.abc,or(id.neq.0)'],
    ['too long', 'E'.repeat(65)],
  ])('rejects %s', async (_label, value) => {
    expect((await runChain(employeeRefParam(), value)).ok).toBe(false);
  });

  test('uuidParam lower-cases too', async () => {
    expect(await runChain(uuidParam(), OWN_ID.toUpperCase())).toEqual({ value: OWN_ID, ok: true });
    expect((await runChain(uuidParam(), 'EMP001')).ok).toBe(false);
  });
});
