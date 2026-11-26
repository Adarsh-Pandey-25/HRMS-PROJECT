-- Super Admin → WhatsApp → Templates: an On / Off switch for each message
-- (owner's request, 26 Nov 2026).
--
-- platform_whatsapp_state.template_switches lists the templates a super
-- admin has switched off, per environment like the pause:
-- {"attendance_short_hours": false}. Off means nobody, in any company, gets
-- that WhatsApp message; emails and in-app notifications are not affected.
-- A template not listed is on, so nothing changes until someone switches a
-- message off (whatsappTemplateSwitches.service.js).
--
-- Additive and safe to run more than once. Until it runs, every template
-- stays on and the switches can't be saved.

ALTER TABLE platform_whatsapp_state
  ADD COLUMN IF NOT EXISTS template_switches JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN platform_whatsapp_state.template_switches IS 'Templates switched off in Super Admin → WhatsApp → Templates, e.g. {"attendance_short_hours": false}. Missing = on.';

INSERT INTO schema_migrations (filename, verified)
  VALUES ('20261126_whatsapp_template_switches.sql', true)
  ON CONFLICT (filename) DO NOTHING;
