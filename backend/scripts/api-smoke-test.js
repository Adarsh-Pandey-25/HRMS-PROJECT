/**
 * Quick smoke test for all API modules. Run: node scripts/api-smoke-test.js
 */
const BASE = process.env.API_URL || 'http://localhost:5000/api';

async function request(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

async function main() {
  const results = [];

  const login = await request('POST', '/auth/login', {
    body: { email: 'admin@company.com', password: 'SystemAdmin@123' },
  });
  const token = login.json?.data?.accessToken;
  if (!token) {
    console.error('Login failed:', login.json);
    process.exit(1);
  }
  results.push(['POST /auth/login', login.ok]);

  const endpoints = [
    ['GET', '/auth/me'],
    ['GET', '/employees/all?limit=5'],
    ['GET', '/attendance/my-attendance?limit=5'],
    ['GET', '/leaves/my-leaves?limit=5'],
    ['GET', '/leaves/types'],
    ['GET', '/payroll/payslips?limit=5'],
    ['GET', '/reimbursements/my-reimbursements?limit=5'],
    ['GET', '/training/my-trainings'],
    ['GET', '/announcements/all?limit=5'],
    ['GET', '/holidays/upcoming'],
    ['GET', '/documents/my-documents?limit=5'],
    ['GET', '/settings'],
    ['GET', '/settings/payroll-components'],
    ['GET', '/reports/team-performance'],
    ['GET', '/notifications?limit=5'],
    ['GET', '/notifications/unread-count'],
    ['GET', '/dashboard/admin'],
    ['GET', '/dashboard/search?q=test'],
    ['GET', '/assets'],
    ['GET', '/assets/categories'],
    ['GET', '/helpdesk/tickets?limit=5'],
    ['GET', '/helpdesk/kb/categories'],
    ['GET', '/recruitment/jobs'],
    ['GET', '/recruitment/candidates'],
    ['GET', '/recruitment/interviews'],
    ['GET', '/recruitment/offers'],
    ['GET', '/performance/goals'],
    ['GET', '/performance/cycles'],
    ['GET', '/performance/team-reviews'],
  ];

  for (const [method, path] of endpoints) {
    const r = await request(method, path, { token });
    const pass = r.ok && r.json?.success !== false;
    results.push([`${method} ${path}`, pass, r.status, r.json?.error?.message || r.json?.message]);
  }

  console.log('\n=== API Smoke Test Results ===\n');
  let failed = 0;
  for (const [label, pass, status, err] of results) {
    const mark = pass ? 'PASS' : 'FAIL';
    if (!pass) failed++;
    console.log(`${mark}  ${label}${!pass ? ` (${status}${err ? ': ' + err : ''})` : ''}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
