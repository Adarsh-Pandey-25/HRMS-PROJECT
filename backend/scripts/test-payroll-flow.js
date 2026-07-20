/**
 * Payroll end-to-end smoke test (all buttons / APIs used by the UI).
 * Run: node scripts/test-payroll-flow.js
 */
require('dotenv').config();

const BASE = process.env.API_BASE || 'http://127.0.0.1:5000/api';
const ACCOUNTS = [
  { email: 'riya.sharma@acmetech.in', password: 'RiyaSharma@123', label: 'Acme admin' },
  { email: 'hr1@company.com', password: 'HROne@123', label: 'HR One' },
  { email: 'admin@company.com', password: 'SystemAdmin@123', label: 'System admin' },
];

const now = new Date();
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();

const results = [];
const log = (ok, name, detail = '') => {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function request(path, { method = 'GET', body, cookie, redirect = 'manual' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
    redirect,
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
  return {
    status: res.status,
    data,
    cookie: setCookie.map((c) => c.split(';')[0]).join('; ') || cookie,
    location: res.headers.get('location'),
  };
}

async function login() {
  let lastErr;
  for (const acc of ACCOUNTS) {
    const res = await request('/auth/login', {
      method: 'POST',
      body: { email: acc.email, password: acc.password },
    });
    if (res.status === 200 && res.data?.success) {
      const employee = res.data.data?.employee || res.data.data;
      console.log(`Logged in as ${acc.label} (${acc.email}) role=${employee?.role}`);
      return { cookie: res.cookie, employee, account: acc };
    }
    lastErr = res.data?.error?.message || `HTTP ${res.status}`;
  }
  throw new Error(`Login failed: ${lastErr}`);
}

async function main() {
  console.log(`\n=== Payroll smoke test ${YEAR}-${String(MONTH).padStart(2, '0')} ===\n`);
  const { cookie, employee } = await login();
  const companyId = employee.company_id;

  // 1) GET month status
  {
    const res = await request(`/payroll/months?month=${MONTH}&year=${YEAR}`, { cookie });
    log(res.status === 200 && res.data?.success !== false, 'GET /payroll/months (status)',
      res.status !== 200 ? JSON.stringify(res.data?.error || res.data).slice(0, 200) : `status=${res.data?.data?.status || 'null'}`);
  }

  // 2) Initialize month
  let payrollMonthId = null;
  {
    const res = await request('/payroll/months', {
      method: 'POST', cookie, body: { month: MONTH, year: YEAR },
    });
    const ok = res.status === 200 || res.status === 201;
    payrollMonthId = res.data?.data?.id;
    log(ok && !!payrollMonthId, 'POST /payroll/months (Initialize Month)',
      ok ? `id=${payrollMonthId}` : JSON.stringify(res.data?.error || res.data).slice(0, 300));
  }

  if (!payrollMonthId) {
    const again = await request(`/payroll/months?month=${MONTH}&year=${YEAR}`, { cookie });
    payrollMonthId = again.data?.data?.id;
  }

  // 3) Generate all draft payslips
  {
    const res = await request('/payroll/payslips/generate', {
      method: 'POST', cookie, body: { payroll_month_id: payrollMonthId },
    });
    const ok = res.status === 200 || res.status === 201;
    const generateResult = res.data?.data;
    const generated = Array.isArray(generateResult)
      ? generateResult.filter((r) => r.status === 'generated').length : 0;
    const skipped = Array.isArray(generateResult)
      ? generateResult.filter((r) => r.status === 'skipped').length : 0;
    const sampleSkip = Array.isArray(generateResult)
      ? generateResult.find((r) => r.status === 'skipped') : null;
    log(ok, 'POST /payroll/payslips/generate (Generate Payslips)',
      ok
        ? `generated=${generated} skipped=${skipped}${sampleSkip ? ` e.g. ${sampleSkip.reason}` : ''}`
        : JSON.stringify(res.data?.error || res.data).slice(0, 400));
  }

  // 4) List payslips
  let payslips = [];
  {
    const res = await request(`/payroll/payslips?month=${MONTH}&year=${YEAR}`, { cookie });
    const ok = res.status === 200;
    payslips = Array.isArray(res.data?.data) ? res.data.data : [];
    log(ok, 'GET /payroll/payslips (Salary Sheet list)',
      ok ? `count=${payslips.length}` : JSON.stringify(res.data?.error || res.data).slice(0, 300));

    if (ok && payslips.length) {
      const p = payslips[0];
      const hasGross = p.gross_salary != null || p.grossSalary != null
        || p.breakdown_json?.totals?.gross_salary != null;
      const hasNet = p.net_salary != null || p.netSalary != null
        || p.breakdown_json?.totals?.net_pay != null;
      log(hasGross && hasNet, 'Payslip calculation fields (gross/net)',
        `gross=${p.gross_salary ?? p.grossSalary} net=${p.net_salary ?? p.netSalary} status=${p.payslip_status}`);
    } else if (ok) {
      log(false, 'Payslip calculation fields (gross/net)', 'No payslips generated');
    }
  }

  // 5) Recalculate from settings
  {
    const res = await request('/payroll/payslips/recalculate-from-settings', {
      method: 'POST', cookie, body: { month: MONTH, year: YEAR },
    });
    log(res.status === 200, 'POST /payroll/payslips/recalculate-from-settings',
      res.status === 200
        ? JSON.stringify(res.data?.data || {}).slice(0, 200)
        : JSON.stringify(res.data?.error || res.data).slice(0, 300));
  }

  // 6) Publish one draft
  let publishedId = null;
  {
    const draft = payslips.find((p) => String(p.payslip_status || '').toUpperCase() !== 'PUBLISHED')
      || payslips[0];
    if (!draft?.id) {
      log(false, 'PUT /payroll/payslips/:id/publish', 'No payslip to publish');
    } else {
      const res = await request(`/payroll/payslips/${draft.id}/publish`, { method: 'PUT', cookie });
      const ok = res.status === 200;
      publishedId = ok ? (res.data?.data?.id || draft.id) : null;
      log(ok, 'PUT /payroll/payslips/:id/publish (Publish)',
        ok ? `id=${publishedId}` : JSON.stringify(res.data?.error || res.data).slice(0, 400));
    }
  }

  // 7) Publish already-published → expect error
  if (publishedId) {
    const res = await request(`/payroll/payslips/${publishedId}/publish`, { method: 'PUT', cookie });
    log(res.status >= 400, 'Publish already-published is rejected',
      `status=${res.status} msg=${res.data?.error?.message || ''}`);
  }

  // 8) Download published PDF
  if (publishedId) {
    const res = await request(`/payroll/payslips/${publishedId}/download`, { cookie, redirect: 'manual' });
    const ok = res.status === 302 || res.status === 200 || (res.status >= 300 && res.status < 400);
    log(ok, 'GET /payroll/payslips/:id/download (Download PDF)',
      ok
        ? `status=${res.status} location=${String(res.location || '').slice(0, 80)}`
        : JSON.stringify(res.data?.error || res.data).slice(0, 300));
  }

  // 9) My payslips
  {
    const res = await request(`/payroll/payslips?month=${MONTH}&year=${YEAR}&mine=true`, { cookie });
    log(res.status === 200, 'GET /payroll/payslips?mine=true (My Payslips)',
      res.status === 200
        ? `count=${(res.data?.data || []).length}`
        : JSON.stringify(res.data?.error || res.data).slice(0, 200));
  }

  // 10) Invalid month id
  {
    const res = await request('/payroll/payslips/generate', {
      method: 'POST', cookie,
      body: { payroll_month_id: '00000000-0000-0000-0000-000000000099' },
    });
    log(res.status >= 400, 'Generate with invalid month id is rejected', `status=${res.status}`);
  }

  // 11) Single employee generate
  if (employee?.id && payrollMonthId) {
    const res = await request('/payroll/payslips/generate', {
      method: 'POST', cookie,
      body: { payroll_month_id: payrollMonthId, user_id: employee.id },
    });
    const ok = res.status === 200 || res.status === 201 || res.status === 409;
    log(ok, 'POST generate for single user_id',
      `status=${res.status} ${res.data?.error?.message || res.data?.message || 'ok'}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== Summary: ${passed} passed, ${failed} failed (company=${companyId}) ===\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err.message);
  process.exit(1);
});
