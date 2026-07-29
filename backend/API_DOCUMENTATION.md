# HRMS Integration API — Client Guide

This guide explains how your IT team can connect external systems (reporting tools, biometric devices, middleware) to HRMS using a **company API key**.

You do **not** use an employee email and password for these integrations. Your HRMS Admin creates an API key in **Settings → Integrations** and shares it with you securely.

---

## 1. Base URL

```
https://api.yourhrms.com/api/integration
```

Replace `api.yourhrms.com` with the hostname provided by your HRMS vendor if different.

| Resource | Full base |
|----------|-----------|
| Integration (ping, employees) | `https://api.yourhrms.com/api/integration` |
| Attendance / biometric | `https://api.yourhrms.com/api/attendance` |

All requests must use **HTTPS** in production.

---

## 2. Authentication

Every request must include your API key.

### Header (recommended)

```
X-API-Key: hrms_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

You may also send:

```
Authorization: Bearer hrms_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Important

- Treat the key like a password. Do not commit it to source control or share it in chat/email in plain text when avoidable.
- Keys are **company-scoped**: the backend automatically limits data to the company that owns the key.
- Keys have **scopes** (permissions). Your Admin enables only what you need, for example:
  - `ping` — connection test
  - `employees:read` — list employees
  - `attendance:write` — biometric punches

---

### cURL example

```bash
curl -s https://api.yourhrms.com/api/integration/ping \
  -H "X-API-Key: hrms_live_YOUR_KEY_HERE"
```

---

### Python (`requests`) example

```python
import requests

BASE = "https://api.yourhrms.com/api/integration"
API_KEY = "hrms_live_YOUR_KEY_HERE"

headers = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json",
}

response = requests.get(f"{BASE}/ping", headers=headers, timeout=30)
response.raise_for_status()
print(response.json())
```

---

## 3. Available Endpoints

Successful responses use this envelope:

```json
{
  "success": true,
  "message": "…",
  "data": { },
  "timestamp": "2026-07-23T12:00:00.000Z"
}
```

---

### `GET /ping` — Health check

**URL:** `https://api.yourhrms.com/api/integration/ping`  
**Required scope:** `ping` *(also accepted if the key has `employees:read` or `attendance:write`)*

Verifies that the API key is valid and returns the linked company.

**Example response**

```json
{
  "success": true,
  "message": "API key is valid",
  "data": {
    "ok": true,
    "company_id": "00000000-0000-0000-0000-000000000001",
    "company_name": "Acme Corp",
    "scopes": ["employees:read"],
    "api_key_id": "…"
  }
}
```

Use this first when onboarding a new integration.

---

### `GET /employees` — List workforce

**URL:** `https://api.yourhrms.com/api/integration/employees`  
**Required scope:** `employees:read`

Returns active employees for **your company only** (up to 500 records).

**Example**

```bash
curl -s https://api.yourhrms.com/api/integration/employees \
  -H "X-API-Key: hrms_live_YOUR_KEY_HERE"
```

**Typical fields in `data`**

| Field | Description |
|-------|-------------|
| `id` | Internal employee UUID |
| `employee_code` | Badge / HR code (e.g. `EMP00001`) |
| `first_name`, `last_name` | Name |
| `email` | Work email |
| `role` | `admin` / `hr` / `manager` / `employee` |
| `department`, `designation` | Org details |
| `is_active` | Always `true` in this list |
| `company_id` | Your company UUID |

---

### `POST /attendance/biometric-webhook` — Biometric punches

**URL:** `https://api.yourhrms.com/api/attendance/biometric-webhook`  
**Required scope:** `attendance:write`  
**Content-Type:** `application/json`

Used by biometric devices or middleware to record check-in / check-out.  
When you authenticate with an API key, the punch is automatically bound to **your company** (you do not need to send another company’s `company_id`).

#### JSON body

| Field | Required | Description |
|-------|----------|-------------|
| `employee_code` | Yes | Employee code configured in HRMS (must match a person in your company) |
| `action` | Yes | `check_in` or `check_out` |
| `device_id` | Recommended | Device / gate identifier (e.g. `GATE-01`) |
| `timestamp` | Optional | Punch time from the device (ISO-8601). If omitted, server time is used by downstream logic where applicable |
| `company_id` | Optional | Ignored when using an API key (company comes from the key) |

#### Example payload

```json
{
  "employee_code": "EMP00001",
  "action": "check_in",
  "device_id": "GATE-01",
  "timestamp": "2026-07-23T09:05:00+05:30"
}
```

#### cURL

```bash
curl -s -X POST https://api.yourhrms.com/api/attendance/biometric-webhook \
  -H "Content-Type: application/json" \
  -H "X-API-Key: hrms_live_YOUR_KEY_HERE" \
  -d "{\"employee_code\":\"EMP00001\",\"action\":\"check_in\",\"device_id\":\"GATE-01\"}"
```

#### Python

```python
import requests

url = "https://api.yourhrms.com/api/attendance/biometric-webhook"
headers = {
    "X-API-Key": "hrms_live_YOUR_KEY_HERE",
    "Content-Type": "application/json",
}
payload = {
    "employee_code": "EMP00001",
    "action": "check_in",
    "device_id": "GATE-01",
}

r = requests.post(url, json=payload, headers=headers, timeout=30)
print(r.status_code, r.json())
```

---

## 4. HTTP Status Codes

| Code | Meaning | What to do |
|------|---------|------------|
| **200** | **Success** — The request was authenticated and processed. Check `success: true` and use `data`. | Continue normal processing. |
| **401** | **Unauthorized / invalid key** — Missing header, wrong key, revoked key, or expired key. | Confirm `X-API-Key` is set. Ask your Admin to issue a new key if the old one was revoked. |
| **403** | **Forbidden** — The key is valid but does not have permission for this action (wrong scope), or the caller is not allowed to perform it for this company context. | Ask your Admin to create/update a key with the required scope (`employees:read`, `attendance:write`, etc.). Do not reuse another company’s key. |
| **404** | Not found — e.g. employee code does not exist in your company. | Verify `employee_code` in HRMS. |
| **400** | Bad request — Invalid JSON or invalid `action`. | Fix the payload and retry. |

Error responses typically look like:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or revoked API key",
    "details": null
  },
  "timestamp": "2026-07-23T12:00:00.000Z"
}
```

---

## 5. Quick checklist for IT admins

1. Receive an API key from your HRMS Admin (Settings → Integrations).
2. Call `GET /ping` and confirm `company_name` is correct.
3. Call only the endpoints allowed by your key’s scopes.
4. Store the key in a secrets manager; rotate (revoke + recreate) if it is exposed.
5. For biometric devices, map each badge/user ID on the device to the HRMS `employee_code`.

---

## 6. Support

If `ping` fails with **401**, the key is wrong or revoked.  
If `ping` succeeds but `employees` or biometric calls return **403**, request the missing scope from your Admin.

For production hostnames, rate limits, and IP allowlisting, contact your HRMS vendor or account manager.
