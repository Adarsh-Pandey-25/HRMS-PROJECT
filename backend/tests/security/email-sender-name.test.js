/**
 * Owner's report, 24 Nov 2026: every email came from one mailbox whose name
 * was one company's (SMTP_FROM), so a subsidiary's people got mail signed
 * with the primary company's name. An email about a company now carries that
 * company's name in front of the same address. No database, nothing sent.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: (...a) => mockDb.current.from(...a) } }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const mockDb = { current: null };
const { makeFakeSupabase } = require('./helpers/fakeSupabase');

let emailService;
beforeAll(() => {
  process.env.SMTP_FROM = 'Spaxads HRMS <no-reply@spaxsync.test>';
  emailService = require('../../src/services/email.service');
});

beforeEach(() => {
  mockDb.current = makeFakeSupabase({
    companies: [
      { id: 'primary', name: 'Spaxads Digital Media Private Limited' },
      { id: 'sub', name: 'TimesPrime 247 News Media Private Limited' },
      { id: 'odd', name: 'Evil "Co" <script>' },
    ],
  });
});

test('a subsidiary\'s email carries the subsidiary\'s name, from the same address', async () => {
  expect(await emailService.senderFor('sub')).toBe('"TimesPrime 247 News Media Private Limited via SpaxSync" <no-reply@spaxsync.test>');
  expect(await emailService.senderFor('primary')).toBe('"Spaxads Digital Media Private Limited via SpaxSync" <no-reply@spaxsync.test>');
});

test('platform emails (no company) and unknown companies keep SMTP_FROM; odd characters are dropped', async () => {
  expect(await emailService.senderFor(null)).toBe('Spaxads HRMS <no-reply@spaxsync.test>');
  expect(await emailService.senderFor('missing')).toBe('Spaxads HRMS <no-reply@spaxsync.test>');
  expect(await emailService.senderFor('odd')).toBe('"Evil Co script via SpaxSync" <no-reply@spaxsync.test>');
});
