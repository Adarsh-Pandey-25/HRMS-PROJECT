const {
  getConfig, canSend, isRecipientAllowed, missingSettings,
} = require('../../src/config/whatsapp');

const KEYS = [
  'WHATSAPP_ENABLED', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_WABA_ID', 'WHATSAPP_BUSINESS_NUMBER',
  'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_ALLOWED_RECIPIENTS', 'NODE_ENV',
];
const saved = {};
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('WhatsApp settings', () => {
  test('off by default — nothing can be sent', () => {
    const cfg = getConfig();
    expect(cfg.enabled).toBe(false);
    expect(canSend(cfg)).toBe(false);
  });

  test('on only with WHATSAPP_ENABLED=true plus a token and a phone number id', () => {
    process.env.WHATSAPP_ENABLED = 'true';
    expect(canSend()).toBe(false);
    process.env.WHATSAPP_ACCESS_TOKEN = 'token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    expect(canSend()).toBe(true);
  });

  test('outside production, only allow-listed numbers may receive — an empty list sends nothing', () => {
    process.env.NODE_ENV = 'development';
    expect(isRecipientAllowed('919876543210')).toBe(false);
    process.env.WHATSAPP_ALLOWED_RECIPIENTS = '+91 98765-43210, +1 555 000 1111';
    expect(isRecipientAllowed('919876543210')).toBe(true);
    expect(isRecipientAllowed('15550001111')).toBe(true);
    expect(isRecipientAllowed('919999999999')).toBe(false);
    expect(isRecipientAllowed(null)).toBe(false); // a hidden number (username only) never passes
  });

  test('production sends to anyone who connected', () => {
    process.env.NODE_ENV = 'production';
    expect(isRecipientAllowed('919999999999')).toBe(true);
    expect(getConfig().environment).toBe('production');
  });

  test('a developer machine is its own environment', () => {
    process.env.NODE_ENV = 'development';
    expect(getConfig().environment).toMatch(/^dev:/);
  });

  test('missingSettings lists what is still needed', () => {
    process.env.NODE_ENV = 'development';
    expect(missingSettings()).toEqual(expect.arrayContaining([
      'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_ALLOWED_RECIPIENTS',
    ]));
  });
});
