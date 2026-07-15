/**
 * Notification API smoke test.
 * Usage: node scripts/test-notifications.js
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

async function login(email, password) {
  const r = await request('POST', '/auth/login', { body: { email, password } });
  const token = r.json?.data?.accessToken;
  if (!token) throw new Error(`Login failed for ${email}: ${JSON.stringify(r.json)}`);
  return token;
}

function assert(label, cond, detail = '') {
  const mark = cond ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${label}${detail ? ` — ${detail}` : ''}`);
  return cond;
}

async function main() {
  console.log('=== Notification API Test ===\n');

  const token = await login('hr1@company.com', 'HROne@123');
  let passed = 0;
  let total = 0;
  const check = (label, cond, detail) => {
    total++;
    if (assert(label, cond, detail)) passed++;
    return cond;
  };

  const list = await request('GET', '/notifications?limit=50', { token });
  check('GET /notifications', list.ok && list.json?.success, `status ${list.status}`);
  const items = list.json?.data || [];
  check('Notifications list is array', Array.isArray(items), `count=${items.length}`);

  const unreadBefore = await request('GET', '/notifications/unread-count', { token });
  const countBefore = Number(unreadBefore.json?.data?.count ?? -1);
  check('GET /notifications/unread-count', unreadBefore.ok, `count=${countBefore}`);

  const unreadItem = items.find((n) => !n.is_read);
  if (unreadItem) {
    const markOne = await request('PUT', `/notifications/${unreadItem.id}/read`, { token });
    check('PUT /notifications/:id/read', markOne.ok, unreadItem.id);

    const unreadAfterOne = await request('GET', '/notifications/unread-count', { token });
    const countAfterOne = Number(unreadAfterOne.json?.data?.count ?? -1);
    check('Unread count decreased after mark read', countAfterOne === countBefore - 1, `${countBefore} → ${countAfterOne}`);
  } else {
    console.log('SKIP  PUT /notifications/:id/read — no unread items');
  }

  const markAll = await request('PUT', '/notifications/read-all', { token });
  check('PUT /notifications/read-all', markAll.ok, `status ${markAll.status}`);

  const unreadFinal = await request('GET', '/notifications/unread-count', { token });
  const countFinal = Number(unreadFinal.json?.data?.count ?? -1);
  check('Unread count is 0 after mark all', countFinal === 0, `count=${countFinal}`);

  // Route ordering: read-all must not be treated as UUID
  const badUuid = await request('PUT', '/notifications/read-all/read', { token });
  check('read-all is not captured by :id/read route', badUuid.status === 404 || !badUuid.ok, `status ${badUuid.status}`);

  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
