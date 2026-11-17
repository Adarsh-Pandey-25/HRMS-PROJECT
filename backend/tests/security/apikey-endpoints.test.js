// Audit #17: company API keys only work on the machine endpoints.
jest.mock('../../src/services/apiKey.service', () => ({
  verifyApiKey: jest.fn(),
  hasScope: (user, scope) => (user.scopes || []).includes(scope),
}));

const { isApiKeyEndpoint } = require('../../src/middleware/apiKey.middleware');

const req = (method, originalUrl) => ({ method, originalUrl });

describe('isApiKeyEndpoint', () => {
  test.each([
    ['GET', '/api/integration/ping'],
    ['GET', '/api/integration/employees?x=1'],
    ['GET', '/api/integration/employees/'],
    ['POST', '/api/attendance/biometric-webhook'],
    ['post', '/API/Attendance/Biometric-Webhook'],
  ])('allows %s %s', (m, u) => {
    expect(isApiKeyEndpoint(req(m, u))).toBe(true);
  });

  test.each([
    ['GET', '/api/attendance/report/2b0c7c1e-1111-4222-8333-944455556666'],
    ['GET', '/api/attendance/my-attendance'],
    ['GET', '/api/employees'],
    ['POST', '/api/integration/ping'],
    ['GET', '/api/attendance/biometric-webhook'],
    ['GET', '/api/integration/ping/../../employees'],
    ['GET', '/api/integration/%70ing'],
    ['GET', ''],
  ])('refuses %s %s', (m, u) => {
    expect(isApiKeyEndpoint(req(m, u))).toBe(false);
  });
});
