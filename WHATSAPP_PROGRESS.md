# WhatsApp notifications: progress

*Branch `whatsapp-integration` · updated 28 Oct 2026*

## Status
| Part | State |
|---|---|
| Server: sending, queue, retries, pause, safety locks | ✅ Built and tested |
| Server: webhook (Meta signature), JOIN / STOP / START / HELP, delivery ticks | ✅ Built and tested |
| Every email and in-app notification → WhatsApp (except the 10 in the guide) | ✅ Built and tested |
| Company switch and groups, each person's groups, paid add-on | ✅ Built |
| Website: profile card, Settings → Integrations card, Super Admin → WhatsApp | ✅ Built (lint and build pass) |
| Automated tests | ✅ 206 passing (`cd backend && npx jest tests/whatsapp`) |
| Database update (new tables) | ✅ Run by you and verified (28 Oct) |
| Settings on your PC (token, secret, 3 test numbers) | ⚠️ Done, but the quick-test token expired on 28 Oct (5:30 pm IST). Next: the permanent token (guide, Part D) |
| First real message ("hello world" to +91•••••59029) | ✅ Sent 28 Oct |
| Templates approved by Meta (test account) | ✅ All 38 approved; Meta filed 4 as marketing (offer response, security alert, platform alert, general update) |
| Webhook (Meta → your PC through the tunnel) | ✅ Verified by Meta on 28 Oct; only the WhatsApp address is reachable. The temporary address changes every time the tunnel restarts (it did on 29 Oct), so Meta needs the new one |
| Add-on switched on for Spaxads | ✅ For testing (the live server still has WhatsApp off) |
| Connect your WhatsApp from your profile | ⏳ Your 2-minute test (WHATSAPP_GO_LIVE.md, 3A) |
| Go-live on the real server | ⏳ See **WHATSAPP_GO_LIVE.md** |

**Nothing changes for anyone yet.** WhatsApp stays off until `WHATSAPP_ENABLED=true`, and then only for companies where a super admin switches the add-on on. Emails and in-app notifications work exactly as before.

## Your next steps (test on your PC with Meta's test number)

**1. Run the database update** (it only adds new tables; nothing existing changes):
1. In VS Code, open `backend/supabase/migrations/20261028_whatsapp_channel.sql` and copy everything.
2. In Supabase, open your project, then **SQL Editor → New query**.
3. Paste and click **Run**. You should see "Success".

**2. Get two values from Meta.** Keep them secret, and never paste them in chat.
- **Access token:** for a quick test, use the token from **WhatsApp → API Setup → Generate access token**. It's short-lived: yours stopped working within a couple of hours. For anything longer, make the permanent one (guide, Part D).
- **App Secret:** **App settings → Basic → App secret → Show**.

**3. Add these lines at the end of `backend/.env`** on your PC, replacing the `<…>` parts:
```
WHATSAPP_ENABLED=true
WHATSAPP_API_VERSION=v26.0
WHATSAPP_PHONE_NUMBER_ID=1190725527466222
WHATSAPP_WABA_ID=2576101372811240
WHATSAPP_BUSINESS_NUMBER=+15556404486
WHATSAPP_ACCESS_TOKEN=<paste the access token>
WHATSAPP_APP_SECRET=<paste the app secret>
WHATSAPP_VERIFY_TOKEN=<any long random text you make up>
WHATSAPP_ALLOWED_RECIPIENTS=<your own WhatsApp number with country code, e.g. +919876543210>
```
- This only affects the server **on your PC**. The live server has its own settings and is not touched.
- `WHATSAPP_ALLOWED_RECIPIENTS` is the safety lock: your PC can only ever message the numbers listed there.

**4. Tell Claude "WhatsApp settings added".** Claude restarts the local server and then:
- sends Meta's "hello world" test from **Super Admin → WhatsApp** to your phone;
- switches the add-on on for **your own company (Spaxads)**. Only people who connect their own WhatsApp get anything, and on your PC only your number can;
- submits the message templates to Meta for approval;
- opens a temporary secure address so Meta can reach your PC (for **Connect WhatsApp**, STOP, and delivered/read ticks).

## Where things are
- **Plan and beginner guide:** `WHATSAPP_INTEGRATION_GUIDE.md`
- **Builder's master prompt:** `WHATSAPP_MASTER_PROMPT.md`
- **Server:**
  - `backend/src/services/whatsapp*.js`
  - `backend/src/config/whatsapp.js`
  - `backend/src/routes/*whatsapp*`
  - `backend/src/controllers/*whatsapp*`
  - database update: `backend/supabase/migrations/20261028_whatsapp_channel.sql`
- **Website:**
  - `HRMS/src/components/whatsapp/WhatsAppUpdatesCard.jsx`
  - `HRMS/src/pages/settings/WhatsAppIntegrationCard.jsx`
  - `HRMS/src/pages/super-admin/WhatsApp.jsx`
  - `HRMS/src/api/whatsapp.api.js`
- **Tests:** `backend/tests/whatsapp/`

## Small additions inside existing files (all inert while WhatsApp is off)
- **Server:**
  - `app.js`: the webhook and the new addresses
  - `server.js`: starts the sender only when switched on
  - `email.service.js` and `notification.service.js`: hand a copy to WhatsApp
  - `featureRegistry.js`: the add-on
  - `.env.example` and `README.md`: notes
- **Website:**
  - `GenericSections.jsx`: the WhatsApp card
  - `EmployeeProfile.jsx`: the card on your own profile
  - `App.jsx` and `SuperAdminLayout.jsx`: the super admin page and menu item
