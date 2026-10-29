# WhatsApp notifications: progress

*Branch `whatsapp-integration` · updated 29 Oct 2026*

## Status
| Part | State |
|---|---|
| Server: sending, queue, retries, pause, safety locks | ✅ Built and tested |
| Server: webhook (Meta signature), JOIN / STOP / START / HELP, delivery ticks | ✅ Built and tested |
| Every email and in-app notification → WhatsApp (except the 10 in the guide) | ✅ Built and tested |
| Company switch and groups, each person's groups, paid add-on | ✅ Built |
| Website: profile card, Settings → Integrations card, Super Admin → WhatsApp | ✅ Built (lint and build pass) |
| Database update (new tables) | ✅ Run by you and verified (28 Oct) |
| First real message ("hello world" from Meta's test number to +91•••••59029) | ✅ Sent 28 Oct |
| Templates on Meta's test account | ✅ All 38 approved; Meta filed 4 as marketing (offer response, security alert, platform alert, general update) |
| Add-on switched on for Spaxads | ✅ For testing (the live server still has WhatsApp off) |
| Real SpaxSync number | ✅ +91 88266 92158 in its own WhatsApp account **SpaxSync** (ID 1679366050470693), separate from 1MissionVault. Your PC uses it since 29 Oct, still only for your 3 numbers |
| Payment method | ✅ Added in Meta |
| Permanent token | ⏳ You (guide, Part D). The quick-test token expired on 28 Oct |
| Meta app: Live mode, webhooks on for SpaxSync only | ⏳ You (WHATSAPP_GO_LIVE.md, 3A) |
| Templates on the SpaxSync account | ⏳ Claude submits them once the permanent token is in |
| Webhook (Meta → your PC through the tunnel) | ✅ Works; only the WhatsApp address is reachable. The address changes whenever the tunnel restarts, so Meta needs the current one |
| Connect your WhatsApp from your profile | ⏳ Your test (WHATSAPP_GO_LIVE.md, 3A) |
| Business verification | ⏳ You; start now (WHATSAPP_GO_LIVE.md, section 2) |
| Go-live on the real server | ⏳ See **WHATSAPP_GO_LIVE.md** |

**Nothing changes for anyone yet.** WhatsApp stays off until `WHATSAPP_ENABLED=true`, and then only for companies where a super admin switches the add-on on. Emails and in-app notifications work exactly as before.

## Your next steps
Follow **WHATSAPP_GO_LIVE.md**: section 3A for the test on your PC, then 3B–3C for the server.

On your PC, `WHATSAPP_ALLOWED_RECIPIENTS` in `backend/.env` is the safety lock: your PC can only ever message the numbers listed there. You type the secrets (token, App Secret) into `.env` yourself; never paste them in chat.

## Where things are
- **Plan and beginner guide:** `WHATSAPP_INTEGRATION_GUIDE.md`
- **Who gets what, and going live:** `WHATSAPP_GO_LIVE.md`
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
