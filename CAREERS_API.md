# SpaxSync Careers API

A company's own website (spaxads.com first) shows the jobs HR posts in SpaxSync, and candidates apply on that website. Every application lands in **SpaxSync → Recruitment → Candidates** with everything the candidate filled in and their resume. HR gets an alert in SpaxSync, by email and on WhatsApp; the candidate gets an "application received" email.

Code: `backend/src/services/careers.service.js`, `backend/src/routes/careersPublic.routes.js`. SQL: `backend/supabase/migrations/20261126_careers_api.sql`.

## 1. Set up in SpaxSync (HR or Admin)

1. **Settings → Recruitment → Careers website**:
   - Add the website addresses, for example `https://spaxads.com` and `https://www.spaxads.com`.
   - Switch **Accept applications from our website** on.
   - Choose which form fields are Required, Optional or not asked.
   - Click **Save**. Saving creates the **careers key**; copy it from this screen.
2. **For each job** (Recruitment → Job Openings → Post a Job / Edit), switch **Show this job on our website** on. You can also add:
   - the short summary, work mode, experience, salary (shown only if you choose to), skills and a closing date;
   - up to 10 extra questions.

A job appears on the website only while it is **open**, **on the website**, and before its **closing date**. Close the job or switch the website toggle off, and it leaves the website within about a minute.

## 2. The API

Base address: `https://spaxsync.com/api/public/careers/v1` (Settings shows it). Every call carries the key in the address: `?key=ck_…`.

| Call | What it returns |
|---|---|
| `GET /jobs?key=…` | `{ company: { name }, jobs: [job…] }`: the open jobs on the website, newest first |
| `GET /jobs/{jobId}?key=…` | `{ company, job, form }`: one job with its description, extra questions and the application form |
| `POST /jobs/{jobId}/apply?key=…` | `201 { status: "received" }`: one application (multipart form, with the resume) |

Answers are wrapped like every SpaxSync answer: `{ "success": true, "message": "…", "data": … }`. Errors: `{ "success": false, "error": { "code", "message", "details" } }`.

### A job

```json
{
  "id": "4c1e…",
  "title": "Ad Sales - CPI",
  "department": "Sales",
  "location": "Sector 48, Gurgaon",
  "employmentType": "full_time",
  "workMode": "on_site",
  "labels": { "employmentType": "Full-time", "workMode": "On site" },
  "summary": "We are looking for strategic sales professionals…",
  "experience": { "min": 2, "max": 5 },
  "salary": null,
  "skills": ["Sales", "CPI"],
  "openings": 2,
  "postedOn": "2026-11-26",
  "closesOn": null
}
```

Details on each field:
- `employmentType` is `full_time`, `part_time`, `contract` or `intern`.
- `workMode` is `on_site`, `remote`, `hybrid` or null.
- `labels` holds ready-made words to show for those two values.
- `salary` is `{ min, max, currency, period }` only when HR chose to show it; otherwise it is null.

`GET /jobs/{jobId}` adds two things to the job:
- **`description`**: safe HTML. SpaxSync keeps only formatting tags, with no attributes, and links only to http, https or mailto addresses.
- **`questions`**: `[{ id, label, type, required, options }]`. The type is `text`, `textarea`, `number`, `yes_no` or `select`.

It also returns the application form:

```json
"form": {
  "fields": { "phone": "required", "resume": "required", "coverNote": "optional" },
  "consentText": "I agree that Spaxads Digital Media may keep the details and resume I send here…",
  "captcha": { "provider": "turnstile", "siteKey": "0x4AAAA…" },
  "resume": { "types": ["pdf", "doc", "docx"], "maxMb": 5 }
}
```

- `fields` lists only the fields to ask, each `required` or `optional`.
- Name, email and the consent box are always asked.
- `captcha` is null when the server's robot check is off.

### Applying

Send a normal form post, `multipart/form-data` (`new FormData(form)`), with **no custom headers**. The fields:

| Field | Notes |
|---|---|
| `name`, `email` | always required |
| `phone` | Indian 10-digit, or `+` and country code |
| `currentLocation`, `experienceYears`, `currentCompany`, `currentCtc`, `expectedCtc`, `noticePeriodDays`, `linkedinUrl`, `portfolioUrl`, `coverNote` | as the form asks |
| `answers[<questionId>]` | one per extra question (or `answers` as a JSON object) |
| `resume` | the file: PDF, DOC or DOCX, up to 5 MB |
| `consent` | `true` when the box is ticked (required) |
| `company_website` | **the spam trap**: a hidden field people never see. Send it empty |
| `cf-turnstile-response` | the robot check's answer, when `form.captcha` is set (the Turnstile widget adds it) |

**When something is wrong**, the answer is `400`:
- `error.message` names the first problem.
- `error.details.fields` lists every field to fix, for example `{ "email": "Enter a valid email address", "answers.q_ab12": "Please answer: …" }`.

**Other answers:**
- `429`: too many applications. The limits are 8 an hour per visitor, plus the company's daily limit.
- `404`: the job is closed, or no longer on the website.

A second application from the same email for the same job is answered `201` and keeps the first one.

## 3. Security

- **The key is public by design.** It sits in the website's page and only says whose jobs to show. SpaxSync accepts it only from pages on the websites listed in Settings: it checks the browser's `Origin`, and CORS allows only those websites. **Applications** are accepted only from those websites.
- **The robot check** (Cloudflare Turnstile) applies to every application once the server has `CAREERS_TURNSTILE_SITE_KEY` and `CAREERS_TURNSTILE_SECRET_KEY` in its `.env`. Add each company's website to the Turnstile widget's hostnames in Cloudflare. If Cloudflare can't be reached, the application is refused, never let through unchecked.
- **Limits:** 120 reads a minute and 8 applications an hour per visitor, and the company's daily limit (200 by default; set in Settings).
- **Checks on what comes in:**
  - every field is checked;
  - the resume's real file type is checked, not just its name;
  - a filled-in spam trap is answered "received", and nothing is saved.
- **The public side shows only** open jobs that HR put on the website, with their public fields. It never shows candidates, notes or hidden salaries.
- **Consent:** the candidate's tick and the exact consent text are saved with the time (India's DPDP Rules).
- **Changing the key:** "Create a new key" in Settings stops the old key at once.

## 4. Smallest example

```html
<div id="jobs"></div>
<script>
  const API = 'https://spaxsync.com/api/public/careers/v1';
  const KEY = 'ck_…';
  fetch(`${API}/jobs?key=${KEY}`)
    .then((r) => r.json())
    .then(({ data }) => {
      for (const job of data.jobs) {
        const p = document.createElement('p');
        p.textContent = `${job.title} · ${job.labels.employmentType}`; // always as text
        document.getElementById('jobs').appendChild(p);
      }
    });
</script>
```

A complete example with the job page and the application form, in spaxads.com's own design, is `static/js/spaxsync-careers.js`. It is kept with the spaxads.com files on the developer's PC (`docs/spaxads-website/`).
