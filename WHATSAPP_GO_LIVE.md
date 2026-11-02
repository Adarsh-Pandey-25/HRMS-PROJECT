# WhatsApp: who gets what, and how to go live

*Written 28 Oct 2026, updated 2 Nov, for the SpaxSync owner. Branch `whatsapp-integration`.*

---

## 1. Who gets which WhatsApp message

Only people whose **WhatsApp is connected** get anything. Employees HR adds from 2 Nov 2026 are connected automatically to the mobile number HR enters (see "Automatic connection" below); everyone else connects from their own profile. Each person can switch any group off, and a company admin can switch a group off for the whole company.

### Every employee
| Group | Messages |
|---|---|
| **Leave** | Your request was sent · approved · not approved · HR changed your balance · your balance is low |
| **Attendance** | Marked absent · marked late · short hours · automatic check-out · attendance correction approved / not approved |
| **Payroll** | Payslip ready · salary revised (**never amounts**) |
| **Requests & helpdesk** | Work-from-home approved / not approved · expense claim approved / not approved · your helpdesk ticket updated · new reply on your ticket · document verified · overdue training |
| **Company news** | New announcement · holiday list published |
| **My celebrations** | Your birthday wish · your work anniversary |
| **Colleagues' celebrations** | "Today is Priya's birthday / work anniversary" |
| **Account** (always) | Your account was deactivated (the last message they get) |

### Managers, in addition
- A team member's **leave**, **work-from-home** or **expense** request is waiting for their approval, when the company's **Approval Flows** ask the manager. The message has the employee's reason and **Approve / Reject** buttons (see "Approving on WhatsApp" below).

### HR, in addition
- Requests waiting for HR under the company's **Approval Flows** (leave, work from home, expenses), and every attendance correction. Requests from people without a manager always go to HR. The message has the reason and **Approve / Reject** buttons.
- **New helpdesk tickets** and replies; **documents uploaded** for checking.
- **Summaries:** daily attendance summary, daily pending-approvals count, weekly joiners & exits.
- **Recruitment:** a candidate accepted or declined an offer.
- **Security:** API key created or revoked, office beacon alerts.

### Company admins, in addition
- **Admin copies:** an employee's leave balance changed; payroll setup changed (PF/ESI on or off — never amounts).
- **Billing:** subscription started, renewed, plan changed, renewal reminder, payment failed, grace period ending, suspended, trial ending, trial ended.
- **Security** alerts (same as HR).

### You, the super admin
Connect in **Super Admin → WhatsApp → My alerts** to get:
- new enquiries;
- failed background jobs;
- unknown biometric devices;
- biometric punches not saving;
- billing job problems.

### Never on WhatsApp
| Emails | Why |
|---|---|
| Welcome & login details, onboarding invite, bulk-import account, day-one welcome | Contain a **password** |
| Password reset code, workspace set-up code | Contain a **secret code** |
| Pre-joining reminder | The person can't have connected yet |
| Offer letter (candidates), workspace invite and enquiry received (new customers) | Not SpaxSync users |

### Good to know
- **Scheduled messages only come from the live server:** attendance alerts, daily and weekly summaries, birthdays, billing reminders and auto check-out. Your PC has scheduled jobs switched off.
- **What's in a message:** it says what happened, plus the person's first name, dates and the company name, and ends with "open SpaxSync for details". It never contains salary or amounts, bank details, passwords or codes. The one exception: approvers see the employee's **reason**, shortened to about 200 characters (your decision, 30 Oct 2026); it's hidden from the Message log once sent.
- **One event, one WhatsApp:** each event sends one message per person, even where SpaxSync sends two emails for it.

### Approving on WhatsApp (added 30 Oct 2026)
Leave, work-from-home, expense and attendance-correction requests reach the approvers with **Approve** and **Reject** buttons.
- **A tap does exactly what the button on the website does**, with the same rules: right role and team, the company's approval steps, nobody approves their own request, and the request must still be pending. The employee is told as usual.
- **Reject is one tap.** The employee sees the reason "Rejected on WhatsApp. Please contact your approver for details."
- **Attendance corrections:** Approve saves the times the employee asked for, then closes the request, like "Save attendance" on the website. To change the times, use the website.
- **Safety:** the buttons only work from the approver's own connected WhatsApp number. Each set works once and stops working after 7 days. They don't work if the approver's account is switched off or the company is suspended. Every decision is recorded with who made it and when.
- **Live since 30 Oct 2026:** Meta approved `approval_request`, and the first leave and work-from-home requests were approved from WhatsApp that afternoon.

### Approval Flows (added 2 Nov 2026)
**Settings → Approval Flows** chooses who approves each kind of request: one card each for **Leave**, **Work from home** and **Expense claims**, with four choices:
- **Manager only:** the manager's approval is final.
- **Manager → HR:** the manager approves first, then HR gives the final approval.
- **HR only:** managers are not asked and can't approve or reject.
- **Manager or HR:** both are asked at the same time; whoever decides first settles it.

**Attendance corrections** stay **HR only**, because approving one changes the attendance record. Requests from people without a manager always go to HR.

**WhatsApp follows the same choice.** The approval message with buttons goes only to whoever's turn it is. Under **Manager → HR**, a manager's Approve on WhatsApp replies "It now goes to HR for the final approval", and HR then gets its own message with buttons.

**Starting choices:** leave and expense claims keep the choice the company already had. Work from home starts on **Manager or HR**, which is how it worked before.

Managers only come into it when employees have **Reporting to** set and that person has the **Manager** role. Today, nobody in Spaxads has a manager, so every request goes to HR and admins.

Database update: `20261102_wfh_approval_flow.sql`. It's needed for **Manager → HR** on work from home; the other choices work without it.

### Automatic connection (added 2 Nov 2026)
- **The mobile number is compulsory** in Add employee and in Bulk import: 10 digits. The numbers are Indian; SpaxSync adds +91.
- **As soon as HR saves the employee** with Add employee, their WhatsApp is connected to that number, and they get the **welcome** (`welcome_new_employee`):
  > **Welcome to Spaxads Digital Media, Priya!** 🎉
  > We're glad to have you on the team.
  >
  > Your HR updates will come here:
  > ✅ Leave approvals · 🕘 Attendance alerts · 💰 Payslips · 📢 Company news
  >
  > Your sign-in details are in your email.
- **Existing employees** get the **announcement** instead (`hr_updates_on_whatsapp`). This covers people added by Bulk import (usually staff who already work there) and anyone whose number HR changes:
  > **HR updates are now on WhatsApp** 📲
  >
  > Hi Priya, Spaxads Digital Media now sends your HR updates here:
  > ✅ Leave approvals · 🕘 Attendance alerts · 💰 Payslips · 📢 Company news
  >
  > You'll still get them by email as before.
- **Neither message has a "Reply STOP" line** (your decision). Replying STOP still works.
- **Only for companies with WhatsApp switched on.** Nothing happens for other companies.
- **If HR changes the number later** (or the employee uses their one-time profile edit), the connection moves to the new number. A connection the employee made themselves, or stopped, is never touched.
- **Ask HR to double-check numbers:** with a wrong number, a stranger gets that person's updates.
- **Until Meta approves the welcome**, it waits, for up to 3 days. The employee's other updates go out as usual.

### Connect everyone (existing employees)
Existing employees are **never** connected automatically. Go to **Super Admin → WhatsApp → Connect employees**. Each company is listed with:
- how many employees it has;
- how many are already connected;
- how many will get the announcement;
- how many have no usable mobile number;
- how many are left alone, because they stopped or disconnected before.

**Connect everyone** connects that company's employees and sends the announcement, after you confirm.
- The button stays off until Meta has approved the announcement, so it always arrives before any other update.
- At most 200 people per press, because of Meta's daily limit until business verification. Press again the next day for the rest.
- People without a usable mobile number are left out: add their number in their employee profile first.

---

## 2. The most important thing before going live

Meta's **test number (+1 555 640 4486)** can message only the up-to-5 numbers on its list, so it can never reach real employees. Since 29 Oct your PC uses the **real SpaxSync number** instead.

To reach **all employees** you need, from Meta:
1. **Business verification** (Business Settings → Security Centre, or **Step 3** in the app's WhatsApp menu). Without it, your whole business account (SpaxSync **and** 1MissionVault together) can message only 250 different people a day; with it, 2,000 and more.
2. ✅ **A real WhatsApp number for SpaxSync:** **+91 88266 92158**, in its own WhatsApp account **SpaxSync** (ID `1679366050470693`), separate from 1MissionVault. In WhatsApp Manager → Phone numbers, check that its display name shows **Approved**.
3. ✅ **A payment method:** added (billed in INR).
4. **A permanent token:** Business Settings → System users (guide, Part D). Give the system user the **SpaxSync** app and the **SpaxSync** WhatsApp account only, not 1MissionVault. The "Generate access token" ones are short-lived: yours stopped working within a couple of hours.
5. **App switched to Live:** App settings → Basic. Add your privacy policy URL `https://spaxsync.com/privacy`, then switch to Live. Meta holds back some webhooks while an app is in Development mode, so do this before testing the real number.

Business verification can take a few days, so **start it now**. You can still put the code on your server today: see 3B.

---

## 3. Go-live steps

### A. Test once on your PC first (recommended)
Your PC now uses the real SpaxSync number, but it can still message only your 3 test numbers. Before you start:
- the permanent token is in `backend/.env` (section 2, item 4);
- in the app's **WhatsApp → Production setup**, **Subscribe webhooks** is **on for SpaxSync** and **off for 1MissionVault**;
- the app is **Live** (section 2, item 5);
- Meta's **Callback URL** is the current tunnel address Claude gives you (same verify token).

Claude then restarts the local server, checks the number with Meta, and submits the 38 templates to the SpaxSync account. Meta approves them again, usually within minutes.
1. Open `http://localhost:5173`, sign in with **your employee account**, and open **your profile**. You'll see the **WhatsApp updates** card.
2. Click **Connect WhatsApp**, then **Open WhatsApp**, and press **Send** from one of your 3 phones.
3. You should get "✅ Connected" on WhatsApp, and the card turns green.

This proves the connect / STOP / delivery-ticks path works before real people use it.

### B. Put the code on the server
Nothing changes for anyone until step C.
1. **Merge the branch** `whatsapp-integration` into `main` and push. Claude can do this when you say **"merge it"**.
2. **On the server:**
   ```bash
   git pull
   cd backend && npm install          # no new packages were added
   pm2 restart hrms-backend --update-env
   cd ../HRMS && npm install
   VITE_BASE_DOMAIN=spaxsync.com PRERENDER_API_URL=http://127.0.0.1:5050 npm run build
   ```
   - **Database:** nothing to do. The WhatsApp tables are already in your database, because you ran the SQL.
   - **nginx:** nothing to change. `/api/` already reaches the backend. Don't restart nginx.

### C. Switch WhatsApp on (after the Meta steps in section 2)
1. **Server settings:** in the **server's** `backend/.env` (on EC2, not your PC), add:
   ```
   WHATSAPP_ENABLED=true
   WHATSAPP_API_VERSION=v26.0
   WHATSAPP_PHONE_NUMBER_ID=1477487558771807
   WHATSAPP_WABA_ID=1679366050470693
   WHATSAPP_BUSINESS_NUMBER=+918826692158
   WHATSAPP_ACCESS_TOKEN=<permanent system-user token>
   WHATSAPP_APP_SECRET=<App secret>
   WHATSAPP_VERIFY_TOKEN=<a NEW long random text>
   ```
   Don't add `WHATSAPP_ALLOWED_RECIPIENTS` there; the live server ignores it. Then run `pm2 restart hrms-backend --update-env`.
2. **Cloudflare:** make sure Meta isn't blocked. In Cloudflare → **Security → WAF**, add a rule that **skips** challenges for the path `/api/whatsapp/webhook`. If **Bot Fight Mode** is on, it can block Meta; check **Security → Events** if the next step fails.
3. **Meta webhook:** developers.facebook.com → your app → **WhatsApp → Configuration → Webhook → Edit**.
   - Callback URL: `https://spaxsync.com/api/whatsapp/webhook`
   - Verify token: the new one from step 1
   - Then **Verify and save**, and make sure **messages** is subscribed.
   - In **WhatsApp → Production setup**, **Subscribe webhooks** stays **on for SpaxSync** and **off for 1MissionVault**.
4. **Templates:** open **Super Admin → WhatsApp → Templates**. If you did the PC test, they're already submitted to the SpaxSync account, so just check they show **approved**. Otherwise click **Submit to Meta** to send all 38, and wait until they show **approved**, usually minutes to a few hours.
5. **Companies:** WhatsApp is already **on for Spaxads**; we switched it on for testing. For other companies, go to **Super Admin → Companies → (company) → Features → WhatsApp notifications**.
6. **People connect** from their own profile (Connect WhatsApp). You connect in **Super Admin → WhatsApp → My alerts**.

### D. After going live
- **Check health:** Super Admin → WhatsApp shows quality, messages, failures and estimated cost.
- **To stop everything instantly:** use **Pause all sending** on that page, or remove `WHATSAPP_ENABLED=true` and restart pm2. Emails and in-app notifications keep working either way.
- **Your PC:** close the tunnel. You can uninstall cloudflared; it's no longer needed.

---

## 4. Why localhost uses `?tenant=spaxads`
On the live site every company has its own address (`spaxads.spaxsync.com`), and that address tells the website which company it is. Your PC has no such addresses, only `localhost`, so on your PC the website reads the company from `?tenant=spaxads` instead. You can also just open `http://localhost:5173` and sign in. Nothing changes on the live site: there it's always the subdomain.
