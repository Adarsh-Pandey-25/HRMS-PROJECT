const express = require('express');
const rateLimit = require('express-rate-limit');
const whatsappWebhookController = require('../controllers/whatsappWebhook.controller');

// Meta's WhatsApp Cloud API webhook. Mounted in app.js BEFORE express.json():
// the signature (X-Hub-Signature-256) covers the raw body, so it must arrive
// untouched. Fully handled here, so the CSRF check, the tenant/host checks
// and the general limiter never see it — it gets its own limiter instead.
const router = express.Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `whatsapp-webhook:${req.ip}`,
});

router.get('/', webhookLimiter, whatsappWebhookController.verify);
router.post('/', webhookLimiter, express.raw({ type: () => true, limit: '1mb' }), whatsappWebhookController.receive);

module.exports = router;
