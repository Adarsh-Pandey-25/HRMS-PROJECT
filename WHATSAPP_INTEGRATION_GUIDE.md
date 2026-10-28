# WhatsApp notifications for SpaxSync: beginner's guide

*Written 28 October 2026. WhatsApp prices and rules change often; the facts below were checked against Meta's own pages on this date (sources at the end).*

---

## 0. In one minute

**What we will build:** **every email SpaxSync sends also arrives on WhatsApp**. So do the in-app notifications that have no email of their own, for example "your leave was approved", "a leave request is waiting for your approval", "your payslip is ready" or "you were marked late today". The only exceptions are a few emails that carry passwords or secret codes, or that go to people who can't connect WhatsApp (section 2, decision 4). Later, managers can **approve or reject straight from WhatsApp**.

**How it works:**
1. SpaxSync gets **one official WhatsApp business number** ("SpaxSync"), set up through Meta (the company that owns WhatsApp).
2. A company's admin switches WhatsApp on in Settings and picks which notifications to send.
3. Each employee **connects their own WhatsApp** in one tap and can switch it off any time.
4. When something happens in SpaxSync (leave approved, payslip published), the server also sends a short WhatsApp message. The in-app notification and the email still go as before.

**Cost:** most messages cost about **₹0.115** each (plus GST), paid to Meta. Announcements, holiday lists and birthday or anniversary wishes count as "marketing" and cost about **₹0.86** each. A company with 50 employees costs roughly **₹100–350 a month**, mostly depending on how many announcements it sends. See section 7.

**Time:**
- **Your part** is the Meta account set-up (section 4): about 1–2 hours of clicking, plus **1–5 working days of waiting** while Meta verifies your business.
- **My part** is the coding (section 5). I can start straight away with Meta's **free test number**, so we don't wait for verification.

---

## 1. How WhatsApp for businesses works (plain words)

| Thing | What it means for us |
|---|---|
| **WhatsApp Business Platform (Cloud API)** | Meta's official system that lets a **server** send WhatsApp messages automatically. It is **not** the green WhatsApp or WhatsApp Business app on your phone, which only lets a person type messages by hand. |
| **Business phone number** | The number messages come from. It must be a number that is **not** used on any WhatsApp app. Employees see the name **"SpaxSync"** with it. |
| **Template** | A message format that Meta approves **in advance**, with blanks to fill, like: "Hi {{1}}, your {{2}} for {{3}} has been approved." **Every message we start must use an approved template.** Approval usually takes minutes to a few hours. |
| **24-hour window** | When an employee **sends us** a message, we can reply freely (no template needed) for 24 hours. Outside that window, only templates are allowed. |
| **Opt-in** | Meta's rule: we may only message a person who has **agreed** to receive messages from us. The agreement must clearly name the business. Employees will give this agreement in one tap (section 3). |
| **Message categories** | Meta puts every template into a category, and the category sets the price. **Utility** covers updates about something the person did or must know: leave approved, payslip ready. It's cheap. **Marketing** covers promotions and general news. It's about 7× more expensive and limited by Meta. **Authentication** is for one-time codes. Our notifications are **Utility**. |
| **Messaging limit** | How many **different people** we can start messages with in 24 hours. A new account starts at **250**. After **business verification** it becomes **2,000**, then rises automatically to 10,000, 100,000 and unlimited while message quality stays good. The limit is shared by all numbers in your Meta business account. |
| **Quality rating** | If people block or report our messages, Meta lowers our rating and can limit us. So we send **only useful messages**, and switching off is **easy**. |
| **Webhook** | A web address on **our** server that Meta calls to tell us things: "message delivered", "message read", or "employee replied STOP". |

---

## 2. The big decisions (with my recommendation)

### Decision 1: whose WhatsApp number sends the messages?

| Option | How it works | Verdict |
|---|---|---|
| **A. One SpaxSync number for all companies** | All companies' messages come from "SpaxSync", and each message names the company: "…approved by Rahul at **Spaxads Digital Media**". | ✅ **Recommended now.** You set up and verify one number once. Companies just switch it on, and you get one bill. This is how most HR software works. |
| B. Each company uses its own WhatsApp number | Each company connects its own number inside SpaxSync. | ⏳ Later, as a premium option. SpaxSync would first have to become a **Meta "Tech Provider"**, which needs a separate Meta review, plus each company verifying its own business. That's too heavy to start with. |

### Decision 2: connect directly to Meta, or go through a reseller?

| Option | Verdict |
|---|---|
| **Direct to Meta (Cloud API)** | ✅ **Recommended.** It's free to use (you pay only Meta's message price), it's Meta's own system, and we write the code ourselves anyway. |
| Through a reseller ("BSP") such as Interakt, AiSensy, Wati, Gupshup or MSG91 | Not needed. Resellers add a monthly fee or a markup, and their main benefit is a click-to-send dashboard for people who don't code. **One exception:** if Meta keeps rejecting your business verification, some resellers can verify you through their partnership. |

### Decision 3: who pays?
SpaxSync pays Meta for all messages, from one Meta account with your card. You can then:
- include WhatsApp in your higher plans, **or**
- sell it as a paid **add-on** (SpaxSync already has plans and subscriptions, so we can make WhatsApp a plan feature).

### Decision 4: what goes to WhatsApp (your rule: every email also goes to WhatsApp)

SpaxSync sends **56 kinds of email** today. With your rule, they split like this.

**✅ 41 go to WhatsApp** for employees, managers, HR and company admins, once that person has connected their WhatsApp:

| Group | Emails |
|---|---|
| Leave | Request sent · waiting for approval (to the manager) · approved · not approved · balance changed (employee and admin copy) · low balance |
| Attendance | Absent, late and short-hours alerts · daily attendance summary (to HR) · automatic check-out · attendance correction approved / not approved |
| Payroll | Payslip ready · salary revised (no amounts) · payroll setting changed (admin copy) |
| Other requests | Work-from-home, expenses, helpdesk tickets, documents (today these only send the general "notification copy" email) |
| HR summaries | Pending approvals summary · joiners and exits summary |
| Recruitment | Offer accepted / rejected (to HR) |
| Account | Account deactivated |
| Security (to admins) | API key created / revoked · office beacon alerts |
| Billing (to the company admin) | Subscription started · renewed · plan changed · renewal reminder · payment failed · grace period ending · suspended · trial ending · trial ended |
| Company news (Meta prices these as **Marketing**, about ₹0.86 each) | Announcements · holiday list · birthday wishes · work anniversary wishes |

**✅ 5 go to you, the super admin**, if you connect your own WhatsApp in super admin: new enquiry, background job failed, two biometric device alerts, and billing job alert.

**❌ 10 never go to WhatsApp:**

| Email | Why |
|---|---|
| Welcome & login details · onboarding invite · bulk-import account · day-one welcome | They contain a **password** |
| Password reset code · workspace set-up code | They contain a **secret code** |
| Pre-joining reminder | The person hasn't signed in yet, so they can't have connected WhatsApp |
| Offer letter (to candidates) · workspace invite and enquiry received (to new customers) | These people aren't SpaxSync users and haven't agreed to WhatsApp messages |

**Rules for every WhatsApp copy:**
- **One WhatsApp per event**, even when SpaxSync sends two emails for it (see Appendix D).
- **The company admin controls it**: Settings → Notifications gets a WhatsApp switch for each group, all on by default.
- **Each employee chooses**: they can switch off any group, for example keep Leave and Payroll but turn off attendance alerts and company news.
- **No sensitive details**: no salary amounts, bank details, leave reasons (a reason can be medical), passwords or codes. The WhatsApp message says what happened, and "open SpaxSync for details".
- **New emails added later**: an automatic check fails if a new kind of email doesn't say whether it goes to WhatsApp, so "every email" stays true.
- **Marketing-priced messages are submitted honestly as Marketing.** Disguising them as Utility can get all our Utility templates blocked for 7–30 days. Meta also limits how many marketing messages one person receives from all businesses, so a few announcements may not arrive on WhatsApp. The email still does.

---

## 3. What employees, managers and HR will see

### Company admin (HR)
**Settings → Notifications → WhatsApp:** switch on, then tick which notifications to send. Nothing is sent to anyone until each employee connects their own WhatsApp.

### Employee: connecting WhatsApp (one tap, their own choice)
1. On their **Profile** page (website, and later the phone app), they tap **"Connect WhatsApp"**.
2. A WhatsApp link opens with a ready-made message such as **`JOIN 482913`**. They just press **Send**.
3. SpaxSync replies on WhatsApp: *"✅ WhatsApp connected. You'll get HR updates from Spaxads Digital Media here. Reply STOP any time to turn them off."*

This one tap does three jobs at once:
- It **proves the number belongs to them**, so there's no SMS code and no cost.
- It **records their agreement** (opt-in), as Meta and India's DPDP Act require.
- It **opens a free reply window**, so the confirmation message costs nothing.

It also keeps working with WhatsApp's new **usernames**, which are rolling out during 2026. A business may not see the phone number of someone who uses a username, but the code still tells us who they are.

### Choosing what to get
After connecting, the employee sees the groups, all switched on: **Leave**, **Attendance alerts**, **Payroll**, **Requests and helpdesk**, and **Company news and celebrations**. Admins also see **Security** and **Billing**. They can switch any group off at any time.

### You, as super admin
You can connect your own WhatsApp in super admin, to get platform alerts such as a new enquiry or a failed background job.

### Switching off
Either reply **STOP** on WhatsApp, or untick it on the Profile page. It stops immediately. Replying **START** turns it back on.

### Example messages
> **SpaxSync**
> Hi Priya, your Casual Leave for 3 Nov – 4 Nov 2026 has been approved by Rahul Sharma at Spaxads Digital Media. You can see the details in SpaxSync.
> *Reply STOP to turn off WhatsApp updates*

> **SpaxSync**
> Hi Rahul, Priya Verma has applied for Casual Leave for 3 Nov – 4 Nov 2026 and is waiting for your approval at Spaxads Digital Media. Please review it in SpaxSync.

---

## 4. Your manual steps on Meta

> **Golden rules while doing these steps**
> - **Never paste a token, password or "App Secret" into this chat.** When we need them, you'll put them into `backend/.env` yourself, and I'll tell you the exact line names.
> - Turn on **two-factor authentication** on the Facebook account you use, and add a **second trusted admin** to the Meta business account, so you never get locked out.
> - Use the **legal company name exactly as on your documents** everywhere.

### Part A: free test set-up (today, about 30 minutes, no verification needed)
- [ ] **A1.** Go to **developers.facebook.com** and log in with your Facebook account. If asked, complete "Register as a developer".
- [ ] **A2.** Click **Create App**. Name it `SpaxSync WhatsApp`, choose the **WhatsApp** use case ("Connect with customers through WhatsApp"), then choose **Create a business portfolio** (or select yours if you already have one) and finish.
- [ ] **A3.** Open the app, then **WhatsApp → API Setup**. Meta automatically gives you:
  - a **free test phone number**, and
  - a **test WhatsApp Business Account**.
- [ ] **A4.** Under **"To"**, add **your own WhatsApp number** as a test recipient, and enter the code WhatsApp sends you. You can add up to 5 numbers; add your second phone too if you like.
- [ ] **A5.** Click **Send message**. You receive Meta's "hello world" message on WhatsApp. 🎉 This proves the set-up works.
- [ ] **A6.** Tell me **"Part A done"**. You don't need to send me anything else yet.

> The test number can **only** message the up-to-5 numbers you added. That means that while we build, **no real employee can ever receive a test message**, even though your local server uses the real database.

### Part B: business verification (do it now; Meta takes 1–5 working days)
- [ ] **B1.** Go to **business.facebook.com → Settings → Business info**. Fill in the **legal name** exactly as on your documents (for example "Spaxads Digital Media Private Limited"), the address, phone and website (`https://spaxsync.com`).
- [ ] **B2.** **Settings → Security Centre → Start verification.** Keep ready:
  - **Legal name proof:** Certificate of Incorporation, **or** GST certificate, **or** company PAN.
  - **Address proof:** GST certificate, utility bill or bank statement in the company name.
  - A way to receive a code: a **business email on your domain** (for example `you@spaxsync.com`), a phone call or SMS, or a domain check.
- [ ] **B3.** Make sure the **website shows the same legal name**, for example in the footer and on the privacy policy page. Meta compares them.
- [ ] **B4.** Submit and wait. If Meta rejects it, send me the exact reason shown (not documents) and I'll tell you what to fix.

### Part C: the real SpaxSync number (after or during Part B)
- [ ] **C1.** Get a **new phone number just for SpaxSync** (a new SIM is easiest). It must:
  - **not** be registered on WhatsApp or WhatsApp Business (or delete it from the app first), and
  - be able to receive **one SMS or call** for verification.
  Keep this SIM safe **forever**; it's how you recover the account.
- [ ] **C2.** In **WhatsApp Manager → Phone numbers → Add phone number**, set:
  - display name: **SpaxSync**, which must match your website brand;
  - category: "Professional services" (or the closest one);
  - then verify by SMS or call.
- [ ] **C3.** Set the number's **two-step verification PIN** and save it in a password manager.
- [ ] **C4.** Wait for **display name approval**, which usually takes a few hours to a few days.
- [ ] **C5.** **Payment method:** Business settings → **Billing & payments** → add a card for WhatsApp. Since 1 January 2026, Indian businesses are billed in **rupees (INR)**. Existing accounts must switch to INR by **31 December 2026**, or Meta stops delivering their messages.

### Part D: the permanent key for our server ("system user token")
- [ ] **D1.** **business.facebook.com → Settings → Users → System users → Add.** Name it `spaxsync-server` and give it the **Admin** role.
- [ ] **D2.** **Assign assets**: the app `SpaxSync WhatsApp` with **Full control**, and your **WhatsApp account** with **Full control**.
- [ ] **D3.** **Generate token.** Choose the app, set expiry to **Never**, and tick the permissions `whatsapp_business_messaging`, `whatsapp_business_management` and `business_management`.
- [ ] **D4.** Copy the token **straight into your password manager**. Meta shows it only once. Don't paste it here.
- [ ] **D5.** Also note these (they are **not** secret, so you can send them to me):
  - **Phone number ID**
  - **WhatsApp Business Account ID**
  - **App ID**

  The **App Secret** (App settings → Basic) **is secret**, so it goes only into `.env`.

### Part E: message templates (about 25; you don't type them)
- [ ] **E1.** Once Part D is done, **our server submits all the templates to Meta for you** through Meta's API. I'll ask your OK first, and it's one command. See Appendix A.
- [ ] **E2.** Open **WhatsApp Manager → Message templates** and watch them turn **Approved**, usually within minutes to a few hours. If one is **Rejected** or "re-categorised", tell me its name and I'll reword it and resubmit.

### Part F: go live (when the code is ready and reviewed)
- [ ] **F1.** **Webhook:** App → WhatsApp → **Configuration**. Set the callback URL to our server address, which I'll give you (something like `https://spaxsync.com/api/webhooks/whatsapp`), and the verify token to the one I generate for you. Click **Verify and save**, then subscribe to **messages**.
- [ ] **F2.** App settings: add the **privacy policy URL** (`https://spaxsync.com/privacy`), then switch the app to **Live**.
- [ ] **F3.** Put the secrets into the **live server's** settings. I'll give you the list of names; you paste the values.
- [ ] **F4.** Switch WhatsApp on **for testorg only** and test with your test users. Then turn it on for Spaxads, then for other companies.

---

## 5. What I will build (in small, testable steps)

Every step is built on a **separate git branch** (not `main`, not the mobile app branch), tested, and shown to you before anything goes live.

| Phase | What I build | What you can test |
|---|---|---|
| **A. Foundations** | Database tables for each employee's WhatsApp connection (number, agreement date, on/off) and for every message sent and its status (sent, delivered, read, failed). The WhatsApp sending service has a **master switch** (off by default) and a **test allow-list**: on your PC, it can only send to your own numbers. | Send yourself a test message from the local server using Meta's test number. |
| **B. Connect and switch off** | The "Connect WhatsApp" button and `JOIN` code, the **webhook** (with Meta's signature check, so fake calls are refused), **STOP/START** replies, and the confirmation message. | Connect your own number, reply STOP, then reply START. |
| **C. Every email on WhatsApp** | WhatsApp is added to the one place **every email** already passes through, plus the in-app notifications that have no email of their own (work-from-home, expenses, helpdesk, documents). A rule list covers **all 56 kinds of email**, with an automatic check so new emails get a rule too. There's one WhatsApp per event. **Settings → Notifications** gets a WhatsApp switch per group, and the existing **"WhatsApp Business — Coming soon"** card under **Settings → Integrations** becomes a real on/off and status card. | In **testorg**: apply for leave as an employee and approve it as admin, publish a payslip, post an announcement. Each email you receive also arrives on WhatsApp, once. |
| **D. Super admin and plans** | A WhatsApp page for you as super admin: messages per company, failures, estimated cost. Also an option to make WhatsApp a **plan feature or add-on**. | Check that the numbers match what you sent. |
| **E. Two-way (optional)** | Managers **approve or reject leave by tapping a button in WhatsApp**, using one-time secure buttons that check it's really that manager's connected WhatsApp. Employees can ask "leave balance" and get an answer. | Approve a testorg leave from WhatsApp. |
| **F. Phone app** | A "Connect WhatsApp" and on/off switch on the app's **My account** screen. | The same as B, from the app. |

**If WhatsApp is down or a message fails**, nothing breaks: the in-app notification and the email still go, and the failure is logged so you can see it.

---

## 6. Safety while we test

Your local server uses the **real database**, so testing has **four locks**:
1. **Meta's test number** can only message the up-to-5 numbers you verified in Part A.
2. **Our own allow-list:** on your PC, the server refuses to send to any number that isn't on your test list, even after we switch to the real number.
3. **Master switch:** WhatsApp stays **off** on the live server until you decide.
4. **Per-company switch:** we turn it on for **testorg** first, so real companies are untouched.

---

## 7. Costs

Meta's prices for India (per **delivered** message, before GST). Check Meta's rate card before budgeting, because Meta updates it a few times a year:

| Category | Price | Used for |
|---|---|---|
| **Utility** | **~₹0.115** | Almost everything: leave, attendance, payroll, requests, summaries, security, billing |
| Authentication | ~₹0.115 | One-time codes (we don't need them, because of the `JOIN` tap) |
| Marketing | ~₹0.863 | Announcements, holiday list, birthday and anniversary wishes |
| Service (free replies inside the 24-hour window) | **First 1,000 a month per number free**, then ~₹0.115 | "WhatsApp connected", "STOP" confirmations, answers in phase E |

**Two changes that started on 1 October 2026:**
- Free-form replies (service messages) are charged again, after the 1,000 free per month.
- Utility templates sent while a reply window is open are **no longer free**.

**Example monthly cost with every email on WhatsApp** (assuming about 4 announcements a month):

| Company size | Utility messages | Marketing messages | Cost a month |
|---|---|---|---|
| 20 employees | ~260 (~₹30) | ~85 (~₹70) | **~₹100** |
| 50 employees | ~650 (~₹75) | ~210 (~₹180) | **~₹250** |
| 200 employees | ~2,600 (~₹300) | ~830 (~₹715) | **~₹1,000** |

About **two-thirds of the cost is announcements**. If a company switches off "Company news" on WhatsApp, its cost drops to roughly a third. Daily attendance alerts are the biggest Utility item.

(Plus GST. There's no monthly fee from Meta, and no reseller fee because we connect directly.)

---

## 8. Rules we must follow

| Rule | How we follow it |
|---|---|
| **Opt-in** (Meta): only message people who agreed, and the agreement must name the business. | The employee's own `JOIN` tap. We store when they agreed and what wording they saw. |
| **Easy opt-out** (Meta and DPDP). | Reply STOP, or untick on the Profile page. Turning it off is as easy as turning it on. |
| **India DPDP Act**: consent, purpose and data sharing. | We add one line to the privacy notice saying WhatsApp updates are sent through Meta. Only the **employee** can connect; HR can't do it for them. |
| **Templates must really be Utility** (Meta checks wording, and misuse can block all our utility templates for 7–30 days). | Short, factual texts with no offers and no "don't miss out". If Meta re-categorises one, we reword it rather than argue. |
| **No sensitive data in messages**. | Section 2, "never send" list. |
| **Keep quality high**. | Only useful notifications, each one switchable, no repeats. |

---

## 9. Risks and how we handle them

| Risk | What we do |
|---|---|
| Meta rejects the business verification | We fix the mismatch (name, address or website), or as a last resort verify through a reseller. |
| A template gets re-categorised as Marketing (7× price) | We get notified, reword it, and resubmit. |
| We hit the 250 or 2,000 people-per-day limit | We verify early (Part B). Higher limits come automatically with good quality. If needed, the system queues and retries. |
| The SpaxSync number gets restricted after reports | Messages are opt-in, short, useful and easy to stop. We watch the quality rating on the super admin page. |
| The token leaks | It only ever lives in server settings, never in code or chat. It can be revoked and replaced in Meta in 2 minutes. |
| WhatsApp or Meta outage | In-app and email still work. WhatsApp retries later or gives up and logs it. |
| A person changes their number or switches to a WhatsApp username | We handle Meta's "user changed number" messages and store Meta's user ID (BSUID) as well as the number. |

---

## 10. What I need from you to start

1. **Do Part A** (free test set-up) and tell me "Part A done".
2. **Start Part B** (business verification) today, because it's the slow part.
3. **Answer the decisions**, or say "go with your recommendations":
   - One SpaxSync number for all companies? (recommended: yes)
   - Direct to Meta? (recommended: yes)
   - WhatsApp included in plans or sold as an add-on?
   - (Already decided: every email also goes to WhatsApp, except the 10 in section 2.)
4. When you're ready for phase A coding, I'll create the branch and start.

---

## Appendix A: templates (about 25; our server submits them for you)

You don't need to type these. Once Part D is done, the server submits them through Meta's API, and you only watch them get approved.

Meta's rules: a template **can't start or end with a blank** ({{n}}), and every blank needs a **sample value**. Footer for every template: `Reply STOP to turn off WhatsApp updates`.

**Planned templates:**
- **Utility:**
  - `request_sent`
  - `approval_waiting`
  - `leave_approved`, `leave_not_approved`
  - `wfh_update`
  - `regularization_update`
  - `expense_update`
  - `ticket_update`
  - `document_update`
  - `leave_balance_update`, `leave_balance_admin`
  - `attendance_alert`, `auto_checkout`, `attendance_summary`
  - `payslip_ready`, `salary_updated`, `payroll_setting_changed`
  - `approvals_summary`, `people_summary`
  - `offer_response`
  - `account_deactivated`
  - `security_alert`
  - `billing_update`
  - `platform_alert`
- **Marketing:** `announcement`, `holiday_list`, `birthday_wish`, `work_anniversary`

Examples of the wording:

| Name | Text | Sample values |
|---|---|---|
| `leave_approved` | Hi {{1}}, your {{2}} for {{3}} has been approved by {{4}} at {{5}}. You can see the details in SpaxSync. | Priya · Casual Leave · 3 Nov – 4 Nov 2026 · Rahul Sharma · Spaxads Digital Media |
| `leave_not_approved` | Hi {{1}}, your {{2}} for {{3}} was not approved by {{4}} at {{5}}. Please open SpaxSync to see the details. | Priya · Casual Leave · 3 Nov – 4 Nov 2026 · Rahul Sharma · Spaxads Digital Media |
| `approval_waiting` | Hi {{1}}, {{2}} has asked for {{3}} for {{4}} at {{5}} and is waiting for your approval. Please review it in SpaxSync. | Rahul · Priya Verma · Casual Leave · 3 Nov – 4 Nov 2026 · Spaxads Digital Media |
| `payslip_ready` | Hi {{1}}, your payslip for {{2}} from {{3}} is now available. Please open SpaxSync to view or download it. | Priya · October 2026 · Spaxads Digital Media |
| `expense_update` | Hi {{1}}, your expense claim "{{2}}" at {{3}} is now {{4}}. Please open SpaxSync for the details. | Priya · Client visit travel · Spaxads Digital Media · approved |
| `ticket_update` | Hi {{1}}, your helpdesk ticket "{{2}}" at {{3}} is now {{4}}. Please open SpaxSync to see the update. | Priya · Laptop not charging · Spaxads Digital Media · resolved |
| `wfh_update` | Hi {{1}}, your work-from-home request for {{2}} at {{3}} was {{4}}. Please open SpaxSync for the details. | Priya · 5 Nov 2026 · Spaxads Digital Media · approved |

(I may adjust these wordings while building, if an event doesn't have one of the details.)

---

## Appendix C: how it fits into SpaxSync's code (for developers)

Checked against the code on 28 Oct 2026.

| Part | Plan |
|---|---|
| **Main hook: every email** | Every company email template exported by `backend/src/services/email.service.js` is wrapped by `withRecipientLinks(name, fn)`, and platform ones by `withEmailType`. The wrapper already knows the email type (`templateTypeKey`) and the structured details, such as the employee object and the leave row. The WhatsApp copy is started there, fire-and-forget with `.catch` (the server exits on an unhandled rejection). That covers all 56 live email types. |
| **Rule for every email type** | Each entry in `emailCatalog.js` `EMAIL_TYPES` gets a `whatsapp` field: either `{ template, category: 'utility' or 'marketing', group }`, or `{ never: 'credentials' or 'not_a_user' }`. A unit test fails if any type, including the 7 not yet live, has no `whatsapp` field. |
| **In-app-only events** | `backend/src/services/notification.service.js` (`createNotification` / `createNotifications`) covers work-from-home, expenses, helpdesk and documents, which otherwise only have the generic `notification` copy. That copy goes whether or not the company's email copies are switched on. |
| **One per event** | A key made of event, record ID and recipient, kept for about 10 minutes in `whatsapp_log`, stops doubles where SpaxSync sends two emails for one event, such as leave approved plus its generic copy. |
| **Message details** | The in-app text is short ("Your leave request (Casual Leave) has been approved."). The WhatsApp step fills the template blanks (dates, approver, company name) by looking up the record ID the notification already carries in `meta` (for example `leave_id`). |
| **New files** | Built to mirror the email system: `whatsappCatalog.js` (event → template and blanks, like `emailCatalog.js`), `whatsapp.service.js` (send to Meta, with retries like `webhook.service.js`), table `whatsapp_log` (like `email_log`, plus `delivered` and `read`) and table `whatsapp_links` (employee connection, BSUID, consent time and wording, on/off). |
| **Phone numbers** | Stored numbers come in mixed formats: 10 digits, or "+91 98765-43210" from invite onboarding. The `JOIN` tap gives us the exact WhatsApp number or BSUID from Meta, so we don't rely on `employees.phone`. |
| **Webhook (Meta → us)** | Three server rules would block it today: the CSRF check (`csrf.middleware.js` needs a browser-only header), the main-domain path allow-list (`hostScope.middleware.js`), and the general rate limiter. The new endpoint gets its own exemptions and its own rate limit. It keeps the **raw body** so it can check `X-Hub-Signature-256` with the App Secret using a constant-time comparison (`express.json` currently discards the raw body). It answers 200 at once and processes in the background. |
| **Settings** | `notification_config.triggers` gets a `whatsapp` flag per event, next to `email` (the unused `mobile` flag shows the shape). The Integrations card at `HRMS/src/pages/settings/GenericSections.jsx` (WhatsApp, "Coming soon") becomes real. |
| **Plans** | A new feature key `whatsapp_notifications` in `config/featureRegistry.js`, so super admin can include it in plans or switch it per company. |
| **Secrets** | Only in server settings (`.env`): `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`. Non-secret: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_API_VERSION`, `WHATSAPP_ENABLED`, `WHATSAPP_TEST_RECIPIENTS`. **Never** in company settings, because `GET /api/settings` returns every setting to HR and admin browsers. |
| **Database change** | One new file, `backend/supabase/migrations/2026MMDD_whatsapp_channel.sql`. It **only adds** new tables and columns and changes nothing existing. It's added to the README migration list, and the owner runs it in the Supabase SQL editor after review. |

---

## Appendix D: things I noticed in today's notifications (not WhatsApp)

Found while reading the code. I haven't changed anything; tell me if you want any of these fixed.

1. **Two emails for one event.** When leave is approved, the employee gets the detailed "leave approved" email **and** a general copy of the in-app notification (I confirmed this one in the code). The same pattern exists for a leave request sent to the manager, leave rejected, payslip published and attendance corrections.
2. **Settings → Notifications:** only the **Email** switches do anything. The **In-app** and **Mobile** switches are saved but never used.
3. On that same screen the email **master switch starts off**. If an admin saves the screen without turning it on, the general notification emails stop for that company.
4. **"Asset assigned"** is listed as a notification, but nothing sends it.
5. Turning **off** email for announcements can still let a general email copy go out.
6. Employee **phone numbers** are saved in different formats depending on where they were typed.

---

## Appendix B: glossary

| Word | Meaning |
|---|---|
| **Meta** | The company that owns WhatsApp, Facebook and Instagram |
| **Business portfolio** (Business Manager) | Your company's account at business.facebook.com that owns the WhatsApp number, app and billing |
| **WABA** | WhatsApp Business Account: the container for your business number(s) and templates |
| **Cloud API** | Meta's service our server calls to send WhatsApp messages |
| **System user token** | A permanent secret key that lets our server send messages. Treat it like a bank password |
| **App Secret** | A secret used to check that webhook calls really come from Meta |
| **Webhook** | Our web address that Meta calls with delivery updates and replies |
| **Template** | A pre-approved message format with blanks |
| **Utility / Marketing / Authentication / Service** | Meta's message categories, which decide the price |
| **BSUID** | Meta's ID for a WhatsApp user, used when their phone number is hidden behind a username |
| **BSP** | A WhatsApp reseller (Interakt, AiSensy, etc.). We don't need one |
| **DPDP Act** | India's Digital Personal Data Protection Act, 2023 |

---

## Sources (checked 28 Oct 2026)
- Meta: [Pricing on the WhatsApp Business Platform](https://developers.facebook.com/docs/whatsapp/pricing)
- Meta: [Messaging limits](https://developers.facebook.com/docs/whatsapp/messaging-limits)
- Meta: [Get opt-in for WhatsApp](https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in)
- Meta: [Cloud API: get started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
- Meta: [Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization)
- Meta: [Business-scoped user IDs (usernames)](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/)
- Meta: [WhatsApp Business Platform changelog](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog/)
- India INR rates (third-party summary of Meta's rate card): [DEV Community, "WhatsApp Business Platform pricing in rupees"](https://dev.to/preciousky_45d956626d31c3/whatsapp-business-platform-pricing-in-rupees-and-the-two-things-that-change-on-1-october-2026-4ko0)
- Business verification documents in India (vendor guides): [Zoko](https://www.zoko.io/post/whatsapp-business-api-documents-needed), [Hyperleap](https://hyperleap.ai/whatsapp-business-api-setup-guide-india)
