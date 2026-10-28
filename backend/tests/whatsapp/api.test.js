const api = require('../../src/services/whatsappApi');

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });
const errorResponse = (status, code, message = 'nope') => ({
  ok: false, status, json: async () => ({ error: { code, message } }),
});

beforeEach(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1190725527466222';
  process.env.WHATSAPP_WABA_ID = '2576101372811240';
  process.env.WHATSAPP_API_VERSION = 'v26.0';
  global.fetch = jest.fn();
});
afterEach(() => {
  delete global.fetch;
  ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_WABA_ID', 'WHATSAPP_API_VERSION'].forEach((k) => delete process.env[k]);
});

describe('whatsappApi', () => {
  test('sends a template to a phone number, token only in the header', async () => {
    global.fetch.mockResolvedValue(okResponse({ messages: [{ id: 'wamid.1' }] }));
    const result = await api.sendTemplate({ phone: '919876543210', template: 'leave_approved', params: ['Priya', 'CL'] });
    expect(result.waMessageId).toBe('wamid.1');
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v26.0/1190725527466222/messages');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      messaging_product: 'whatsapp', to: '919876543210', type: 'template',
      template: { name: 'leave_approved', language: { code: 'en' } },
    });
    expect(body.template.components[0].parameters).toEqual([{ type: 'text', text: 'Priya' }, { type: 'text', text: 'CL' }]);
    expect(init.body).not.toContain('test-token');
  });

  test('a hidden number is addressed by BSUID in the recipient field', async () => {
    global.fetch.mockResolvedValue(okResponse({ messages: [{ id: 'wamid.2' }] }));
    await api.sendTemplate({ bsuid: 'IN.abc123', template: 'payslip_ready', params: [] });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.recipient).toBe('IN.abc123');
    expect(body.to).toBeUndefined();
  });

  test('marketing templates carry the stop payload', async () => {
    global.fetch.mockResolvedValue(okResponse({ messages: [{ id: 'wamid.3' }] }));
    await api.sendTemplate({ phone: '1', template: 'company_announcement', params: ['a'], quickReplyPayload: 'WA_STOP_MARKETING' });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.template.components[1]).toEqual({
      type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'WA_STOP_MARKETING' }],
    });
  });

  test.each([
    [130429, true, false],
    [131056, true, false],
    [131000, true, false],
    [190, false, true],
    [131031, false, true],
    [131042, false, true],
    [131026, false, false],
    [131049, false, false],
    [132001, false, false],
  ])('Meta error %i → retry %s, pause %s', async (code, retryable, pauseSending) => {
    global.fetch.mockResolvedValue(errorResponse(400, code));
    await expect(api.sendTemplate({ phone: '1', template: 't' })).rejects.toMatchObject({ code, retryable, pauseSending });
  });

  test('a network failure or timeout is retried later', async () => {
    global.fetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(api.sendTemplate({ phone: '1', template: 't' })).rejects.toMatchObject({ retryable: true });
  });

  test('a server error (5xx) is retried later', async () => {
    global.fetch.mockResolvedValue(errorResponse(503, 1));
    await expect(api.sendTemplate({ phone: '1', template: 't' })).rejects.toMatchObject({ retryable: true });
  });

  test('without a token nothing is sent and sending pauses', async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    await expect(api.sendTemplate({ phone: '1', template: 't' })).rejects.toMatchObject({ pauseSending: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
