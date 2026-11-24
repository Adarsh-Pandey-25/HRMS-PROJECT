/**
 * Owner, 24 Nov 2026: a subsidiary's important details are mandatory — legal
 * name, registered address (line 1, city, Indian state, 6-digit PIN), PAN,
 * contact email and website. Adding a subsidiary without them is refused
 * (naming what's missing), they are saved where the company's page reads
 * them, and editing can't blank one. The primary company isn't held to it.
 * Real routes, controller and service; companies and settings are in memory.
 * Nothing is sent and backend/.env is never read.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => require('./subsidiary-fakeDb'));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));
jest.mock('../../src/services/auditLog.service', () => ({ logAudit: jest.fn(() => Promise.resolve()), auditFromRequest: jest.fn() }));
jest.mock('../../src/services/storage.service', () => ({
  STORAGE_BUCKETS: { documents: 'documents' },
  uploadCompanyLogo: jest.fn(),
  uploadCompanyBrandIcon: jest.fn(),
  getSignedUrl: jest.fn(async () => null),
}));
jest.mock('../../src/utils/slug', () => ({
  suggestUniqueSlug: jest.fn(async (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')),
  checkSlugAvailability: jest.fn(async (slug) => ({ slug, status: 'available' })),
}));
// Settings: one in-memory map per company.
jest.mock('../../src/services/settings.service', () => {
  const store = {};
  const key = (k, cid) => `${cid}:${k}`;
  return {
    store,
    getSetting: jest.fn(async (k, fallback = null, cid = null) => (key(k, cid) in store ? JSON.parse(JSON.stringify(store[key(k, cid)])) : fallback)),
    setSetting: jest.fn(async (k, value, _by, cid) => { store[key(k, cid)] = JSON.parse(JSON.stringify(value)); return { data: null, error: null }; }),
    seedCompanySettings: jest.fn(async (cid, profile) => { store[key('company_profile', cid)] = JSON.parse(JSON.stringify(profile || {})); }),
  };
});
// Companies and their hierarchy, read from the in-memory companies table.
jest.mock('../../src/services/tenant.service', () => {
  const { db } = require('./subsidiary-fakeDb');
  const find = (id) => (db.tables.companies || []).find((c) => String(c.id) === String(id)) || null;
  const orgIds = async (id) => {
    const self = find(id);
    if (self?.company_type !== 'parent') return [id];
    return [id, ...db.tables.companies.filter((c) => c.parent_company_id === id).map((c) => c.id)];
  };
  return {
    getCompanyById: jest.fn(async (id) => (find(id) ? { ...find(id) } : null)),
    getOrgCompanyIds: jest.fn(orgIds),
    isCompanyInOrg: jest.fn(async (actor, target) => (await orgIds(actor)).map(String).includes(String(target))),
    promoteToParentIfNeeded: jest.fn(async (id) => { find(id).company_type = 'parent'; }),
    assertHierarchyReady: jest.fn(),
    ensureCompanyRow: jest.fn(async (row) => { db.tables.companies.push({ is_active: true, ...row }); return row; }),
  };
});
// Signed in as whoever the test says (header x-test-user).
jest.mock('../../src/middleware/auth.middleware', () => ({
  authenticate: (req, res, next) => { req.user = JSON.parse(req.headers['x-test-user']); next(); },
}));

const express = require('express');
const request = require('supertest');
const { reset, db } = require('./subsidiary-fakeDb');
const settingsStore = require('../../src/services/settings.service').store;
const { errorHandler } = require('../../src/middleware/errorHandler.middleware');

const app = express();
app.use(express.json());
app.use('/api/companies', require('../../src/routes/company.routes'));
app.use(errorHandler);

const PRIMARY = '11111111-1111-4111-8111-111111111111';
const SUB = '22222222-2222-4222-8222-222222222222';
const admin = { id: 'aaaaaaaa-1111-4111-8111-111111111111', role: 'admin', company_id: PRIMARY };
const as = (user) => ({
  post: (url, body) => request(app).post(url).set('x-test-user', JSON.stringify(user)).send(body),
  patch: (url, body) => request(app).patch(url).set('x-test-user', JSON.stringify(user)).send(body),
  get: (url) => request(app).get(url).set('x-test-user', JSON.stringify(user)),
});

const REQUIRED = {
  legalName: 'North Branch Private Limited',
  addressLine1: '4th Floor, Nexus Tower',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560095',
  pan: 'ABCDE1234F',
  contactEmail: 'admin@northbranch.in',
  website: 'https://www.northbranch.in',
};
const profileOf = (cid) => settingsStore[`${cid}:company_profile`];

beforeEach(() => {
  reset({
    companies: [
      { id: PRIMARY, name: 'Acme', slug: 'acme', is_active: true, company_type: 'parent', parent_company_id: null },
      { id: SUB, name: 'Acme South', slug: 'acme-south', is_active: true, company_type: 'child', parent_company_id: PRIMARY },
    ],
    employees: [],
  });
  Object.keys(settingsStore).forEach((k) => delete settingsStore[k]);
  settingsStore[`${PRIMARY}:company_profile`] = { name: 'Acme' };
  settingsStore[`${SUB}:company_profile`] = { name: 'Acme South', ...REQUIRED, gstin: '29ABCDE1234F1Z5' };
});

describe('adding a subsidiary', () => {
  test('refused without the required details, naming each one; nothing is created', async () => {
    const res = await as(admin).post('/api/companies/children', { name: 'North Branch' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      'A subsidiary needs these details: Legal name, Address line 1, City, State, PIN code, PAN, Contact email, Website.',
    );
    expect(res.body.error.details.fields).toEqual(['legalName', 'addressLine1', 'city', 'state', 'pincode', 'pan', 'contactEmail', 'website']);

    // Only the missing ones are named, and badly formed ones say why.
    const some = await as(admin).post('/api/companies/children', {
      name: 'North Branch', ...REQUIRED, pan: '', website: ' ', pincode: '5600', state: 'Atlantis', contactEmail: 'admin@',
    });
    expect(some.status).toBe(400);
    expect(some.body.error.message).toBe(
      'A subsidiary needs these details: PAN, Website. State must be an Indian state. PIN code must be 6 digits. Contact email is not a valid email address.',
    );
    expect(await as(admin).post('/api/companies/children', { name: 'North Branch', ...REQUIRED, pan: 'ABCD1234F' }))
      .toMatchObject({ status: 400, body: { error: { message: expect.stringContaining('PAN must be 5 letters, 4 digits and a letter') } } });
    expect(await as(admin).post('/api/companies/children', { name: 'North Branch', ...REQUIRED, website: 'northbranch' }))
      .toMatchObject({ status: 400, body: { error: { message: expect.stringContaining('Website must be the company\'s domain') } } });

    expect(db.tables.companies).toHaveLength(2);
  });

  test('created with them, saved in its profile where its page reads them', async () => {
    const res = await as(admin).post('/api/companies/children', {
      name: 'North Branch', ...REQUIRED, pan: 'abcde1234f', state: 'ka', gstin: '', addressLine2: 'Koramangala',
    });
    expect(res.status).toBe(201);
    const id = res.body.data.id;
    expect(res.body.data).toMatchObject({ companyType: 'child', missingDetails: [], website: REQUIRED.website, contactEmail: REQUIRED.contactEmail });

    expect(profileOf(id)).toMatchObject({
      ...REQUIRED, name: 'North Branch', pan: 'ABCDE1234F', state: 'Karnataka', addressLine2: 'Koramangala', country: 'India',
    });
    const details = await as(admin).get(`/api/companies/${id}/details`);
    expect(details.status).toBe(200);
    expect(details.body.data.profile).toMatchObject({ ...REQUIRED, pan: 'ABCDE1234F', country: 'India' });
  });
});

describe('editing company details', () => {
  test('a subsidiary\'s required detail can\'t be blanked or broken; other edits save', async () => {
    const blank = await as(admin).patch(`/api/companies/${SUB}/details`, { pan: '', contactEmail: '  ' });
    expect(blank.status).toBe(400);
    expect(blank.body.error.message).toBe('A subsidiary needs these details: PAN, Contact email.');
    const broken = await as(admin).patch(`/api/companies/${SUB}/details`, { pincode: '56009' });
    expect(broken.body.error.message).toBe('PIN code must be 6 digits.');
    expect(profileOf(SUB)).toMatchObject(REQUIRED);

    // Optional details stay optional.
    const ok = await as(admin).patch(`/api/companies/${SUB}/details`, { gstin: '', cin: '', directors: [], city: 'Mysuru' });
    expect(ok.status).toBe(200);
    expect(profileOf(SUB)).toMatchObject({ ...REQUIRED, city: 'Mysuru', gstin: '', cin: '' });
  });

  test('a subsidiary still missing details is told which, and must fill them in to save; the list flags it', async () => {
    settingsStore[`${SUB}:company_profile`] = { name: 'Acme South', legalName: 'Acme South Pvt Ltd', city: 'Pune' };
    const list = await as(admin).get('/api/companies/accessible');
    const sub = list.body.data.find((c) => c.id === SUB);
    expect(sub.missingDetails).toEqual(['addressLine1', 'state', 'pincode', 'pan', 'contactEmail', 'website']);
    expect(list.body.data.find((c) => c.id === PRIMARY).missingDetails).toEqual([]);

    const res = await as(admin).patch(`/api/companies/${SUB}/details`, { tagline: 'We build' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('A subsidiary needs these details: Address line 1, State, PIN code, PAN, Contact email, Website.');

    const done = await as(admin).patch(`/api/companies/${SUB}/details`, { ...REQUIRED, tagline: 'We build' });
    expect(done.status).toBe(200);
    expect(done.body.data.missingDetails).toEqual([]);
  });

  test('the primary company saves without them, and can blank its own', async () => {
    const res = await as(admin).patch(`/api/companies/${PRIMARY}/details`, { tagline: 'Since 1999', gstin: '' });
    expect(res.status).toBe(200);
    expect(profileOf(PRIMARY)).toMatchObject({ name: 'Acme', tagline: 'Since 1999' });

    settingsStore[`${PRIMARY}:company_profile`] = { name: 'Acme', ...REQUIRED };
    const blanked = await as(admin).patch(`/api/companies/${PRIMARY}/details`, { pan: '', website: '', state: 'Somewhere' });
    expect(blanked.status).toBe(200);
    expect(profileOf(PRIMARY)).toMatchObject({ pan: '', website: '', state: 'Somewhere' });
  });
});

describe('Settings → Company Profile, signed in to a subsidiary', () => {
  const { updateKey } = require('../../src/controllers/settings.controller');
  const save = async (companyId, value) => {
    let failure = null;
    await updateKey(
      { params: { key: 'company_profile' }, body: { value }, user: { id: 'u1', role: 'admin', company_id: companyId }, ip: '127.0.0.1' },
      { status: () => ({ json: () => {} }), json: () => {} },
      (err) => { failure = err; },
    );
    return failure;
  };

  test('a required detail can\'t be blanked; anything else saves, even while some are missing', async () => {
    expect((await save(SUB, { website: '' }))?.message).toBe('A subsidiary needs these details: Website.');
    expect(profileOf(SUB).website).toBe(REQUIRED.website);
    expect(await save(SUB, { tagline: 'South', timezone: 'Asia/Kolkata' })).toBeNull();

    settingsStore[`${SUB}:company_profile`] = { name: 'Acme South' };
    expect(await save(SUB, { brandColor: '#0F766E' })).toBeNull();
    expect(await save(PRIMARY, { website: '', pan: '' })).toBeNull();
  });
});
