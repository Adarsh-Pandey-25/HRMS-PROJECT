const { getConfig } = require('../config/whatsapp');
const { runInBackground } = require('../utils/background');
const catalog = require('./whatsappCatalog');
const outbox = require('./whatsappOutbox.service');
const L = require('./whatsappLookup');

/**
 * The hooks that give every email and in-app notification its WhatsApp
 * copy. Called by email.service.js (after each email template, and after a
 * direct sendEmail for platform alerts) and by notification.service.js
 * (after in-app notifications are saved).
 *
 * With WhatsApp switched off — the default — each hook returns at once.
 * Switched on, the work runs in the background and never throws: an email or
 * notification is never delayed, changed or failed by its WhatsApp copy.
 */

const isOn = () => getConfig().enabled;

const resolveRecipients = async (to) => {
  if (!to) return [];
  if (to.superAdmins) return 'super_admins';
  if (to.email) {
    const id = await L.employeeIdByEmail(to.email.companyId, to.email.address);
    return id ? [{ subjectType: 'employee', subjectId: id }] : [];
  }
  return [...new Set(to.employees || [])].map((id) => ({ subjectType: 'employee', subjectId: id }));
};

const queue = async (event, { template, group, source }) => {
  const recipients = await resolveRecipients(event.to);
  if (recipients !== 'super_admins' && !recipients.length) return 0;
  return outbox.queueEvent({
    eventKey: event.key,
    source,
    recordKey: event.record ? String(event.record) : '',
    template: event.template || template,
    group: event.group || group,
    recipients,
    params: event.values,
  });
};

/** After an email template ran: `typeKey` as in emailCatalog.js, `args` the template's arguments. */
const fromEmail = (typeKey, args) => {
  if (!isOn()) return;
  const rule = catalog.EMAIL_RULES[typeKey];
  if (!rule || rule.never) return;
  runInBackground(`WhatsApp copy of ${typeKey} email`, async () => {
    const event = rule.event(Array.isArray(args) ? args : []);
    if (event) await queue(event, { template: rule.template, group: rule.group, source: `email:${typeKey}` });
  });
};

/** After a direct sendEmail({ type, subject }) — only platform alerts become messages. */
const fromDirectEmail = (options) => {
  if (!isOn()) return;
  const event = catalog.directEmailEvent(options || {});
  if (!event) return;
  runInBackground(`WhatsApp copy of ${options.type} email`, () => queue(event, { source: `email:${options.type}` }));
};

/**
 * After in-app notification rows were inserted. A fan-out (an announcement
 * to everyone) becomes one event with many recipients, so links, people and
 * settings are read once, not once per person.
 */
const fromNotifications = (rows) => {
  if (!isOn() || !Array.isArray(rows) || !rows.length) return;
  runInBackground('WhatsApp copy of in-app notifications', async () => {
    const merged = new Map();
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      const events = await catalog.notificationEvents(row);
      for (const event of events) {
        const key = `${event.template}|${event.key}|${event.record}`;
        const existing = merged.get(key);
        if (existing) existing.to.employees.push(...event.to.employees);
        else merged.set(key, { ...event, to: { employees: [...event.to.employees] }, source: `notification:${row?.type}` });
      }
    }
    for (const event of merged.values()) {
      // eslint-disable-next-line no-await-in-loop
      await queue(event, { source: event.source });
    }
  });
};

module.exports = { fromEmail, fromDirectEmail, fromNotifications };
