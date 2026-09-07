const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');
const subscriptionService = require('./subscription.service');
const logger = require('../utils/logger');

/**
 * Same caveat as subscriptionAnalytics.service.js's churn(): no
 * subscription-state-snapshot history table exists, so "still active N
 * months later" reads the CURRENT subscription status rather than a true
 * point-in-time snapshot — a company that churned and later resubscribed
 * reads as still-retained. Directionally useful, not audit-grade.
 */
const cohortRetention = async (months = 12) => {
  const since = moment().subtract(months - 1, 'months').startOf('month').toISOString();
  const { data: companies, error } = await supabaseAdmin
    .from('companies')
    .select('id, created_at, company_billing_subscriptions(status)')
    .gte('created_at', since);
  if (error) throw new BadRequestError(error.message);

  const LIVE = new Set(['trialing', 'active', 'past_due', 'grace_period']);
  const cohorts = new Map();
  for (const c of companies || []) {
    const month = moment(c.created_at).format('YYYY-MM');
    if (!cohorts.has(month)) cohorts.set(month, { month, totalCompanies: 0, stillActive: 0 });
    const entry = cohorts.get(month);
    entry.totalCompanies += 1;
    const isLive = (c.company_billing_subscriptions || []).some((s) => LIVE.has(s.status));
    if (isLive) entry.stillActive += 1;
  }

  return [...cohorts.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((c) => ({ ...c, retentionPct: c.totalCompanies > 0 ? Math.round((c.stillActive / c.totalCompanies) * 1000) / 10 : 0 }));
};

const listFailedPayments = async ({ page = 1, limit = 20 } = {}) => {
  const offset = (page - 1) * limit;
  const { data, error, count } = await supabaseAdmin
    .from('subscription_payment_attempts')
    .select('*, subscription_invoices(id, invoice_number, amount, company_id, company_subscription_id, status, companies(id, name))', { count: 'exact' })
    .eq('status', 'failed')
    .order('attempted_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new BadRequestError(error.message);
  return { data: data || [], total: count || 0 };
};

const retryFailedPayment = async (attemptId, actorId) => {
  const { data: attempt, error } = await supabaseAdmin
    .from('subscription_payment_attempts')
    .select('*, subscription_invoices(*)')
    .eq('id', attemptId)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!attempt) throw new NotFoundError('Payment attempt not found');
  const invoice = attempt.subscription_invoices;
  if (!invoice) throw new NotFoundError('Invoice for this attempt not found');
  if (invoice.status === 'paid') throw new ConflictError('This invoice is already paid');

  const subscription = await subscriptionService.getSubscriptionOrThrow(invoice.company_subscription_id);
  const result = await subscriptionService.chargePaymentMethod(subscription, invoice);

  const { data: newAttempt, error: attemptError } = await supabaseAdmin
    .from('subscription_payment_attempts')
    .insert({
      subscription_invoice_id: invoice.id,
      attempt_number: (attempt.attempt_number || 1) + 1,
      status: result.success ? 'success' : 'failed',
      failure_reason: result.success ? null : (result.gatewayResponse?.error || 'Retry failed'),
      gateway_response: result.gatewayResponse,
    })
    .select('*')
    .single();
  if (attemptError) throw new BadRequestError(attemptError.message);

  if (result.success) {
    await supabaseAdmin
      .from('subscription_invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString(), payment_method: 'manual_retry' })
      .eq('id', invoice.id);
    await supabaseAdmin.from('subscription_events').insert({
      company_subscription_id: invoice.company_subscription_id,
      event_type: 'payment_recovered',
      triggered_by: 'super_admin',
      triggered_by_user_id: actorId,
      metadata: { invoiceId: invoice.id, manualRetry: true },
    });
  }

  logger.info('[BillingOps] Manual payment retry', { attemptId, invoiceId: invoice.id, success: result.success, actorId });
  return { attempt: newAttempt, invoicePaid: result.success };
};

/**
 * A negative-amount line-item invoice, matching the existing subscription_invoices
 * schema and line_items jsonb shape (appendDraftInvoiceLineItem in
 * subscription.service.js uses the same {description, amount, ...} shape) —
 * no new credit-type column needed. status='paid' immediately since a
 * credit isn't something anyone needs to separately pay off.
 */
const issueManualCredit = async (companyId, amount, reason, actorId) => {
  const numericAmount = Number(amount);
  if (!numericAmount || numericAmount <= 0) throw new BadRequestError('A positive credit amount is required');
  if (!reason || !String(reason).trim()) throw new BadRequestError('A reason is required for a manual credit');

  const { data: subscription, error: subError } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('id, billing_cycle, seat_count')
    .eq('company_id', companyId)
    .in('status', ['trialing', 'active', 'past_due', 'grace_period', 'suspended'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subError) throw new BadRequestError(subError.message);
  if (!subscription) throw new NotFoundError('This company has no subscription to credit');

  // Double-click / double-submit guard: this is an INSERT, not an update
  // with a natural conflict target, so a race here means two identical
  // credit invoices rather than a corrupted amount — cheaper to prevent by
  // checking for a just-issued duplicate than to build full idempotency-key
  // infrastructure for a super-admin-only action with a visible audit trail.
  const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
  const { data: recentDuplicate } = await supabaseAdmin
    .from('subscription_invoices')
    .select('id')
    .eq('company_id', companyId)
    .eq('payment_method', 'credit')
    .eq('payment_reference', reason)
    .eq('amount', -Math.abs(numericAmount))
    .gte('issued_at', tenSecondsAgo)
    .limit(1)
    .maybeSingle();
  if (recentDuplicate) {
    throw new ConflictError('An identical credit was just issued for this company — refresh before issuing another.');
  }

  const invoiceNumber = `CR-${Date.now().toString(36).toUpperCase()}`;
  const { data: invoice, error } = await supabaseAdmin
    .from('subscription_invoices')
    .insert({
      company_subscription_id: subscription.id,
      company_id: companyId,
      invoice_number: invoiceNumber,
      amount: -Math.abs(numericAmount),
      billing_cycle: subscription.billing_cycle,
      seat_count_at_invoice: subscription.seat_count,
      status: 'paid',
      issued_at: new Date().toISOString(),
      paid_at: new Date().toISOString(),
      payment_method: 'credit',
      payment_reference: reason,
      line_items: [{ description: `Manual credit: ${reason}`, amount: -Math.abs(numericAmount) }],
    })
    .select('*')
    .single();
  if (error) throw new BadRequestError(error.message);

  await supabaseAdmin.from('subscription_events').insert({
    company_subscription_id: subscription.id,
    event_type: 'created',
    triggered_by: 'super_admin',
    triggered_by_user_id: actorId,
    metadata: { manualCredit: true, amount: numericAmount, reason },
  });

  return invoice;
};

/**
 * Records a payment received OUTSIDE the normal automated flow (bank
 * transfer, cash, an off-cycle custom charge) as an already-paid invoice.
 * Positive amount — the mirror-image case of issueManualCredit's negative
 * one, kept as a genuinely separate function/endpoint per the explicit
 * "these are different actions, label them distinctly" instruction, even
 * though the two share the same subscription-lookup and insert shape.
 */
const issueManualInvoice = async (companyId, amount, description, reference, actorId) => {
  const numericAmount = Number(amount);
  if (!numericAmount || numericAmount <= 0) throw new BadRequestError('A positive invoice amount is required');
  if (!description || !String(description).trim()) throw new BadRequestError('A description is required for a manual invoice');
  if (!reference || !String(reference).trim()) throw new BadRequestError('A payment reference/note is required for a manual invoice');

  const { data: subscription, error: subError } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('id, billing_cycle, seat_count')
    .eq('company_id', companyId)
    .in('status', ['trialing', 'active', 'past_due', 'grace_period', 'suspended'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subError) throw new BadRequestError(subError.message);
  if (!subscription) throw new NotFoundError('This company has no subscription to invoice');

  const invoiceNumber = `MI-${Date.now().toString(36).toUpperCase()}`;
  const { data: invoice, error } = await supabaseAdmin
    .from('subscription_invoices')
    .insert({
      company_subscription_id: subscription.id,
      company_id: companyId,
      invoice_number: invoiceNumber,
      amount: Math.abs(numericAmount),
      billing_cycle: subscription.billing_cycle,
      seat_count_at_invoice: subscription.seat_count,
      status: 'paid',
      issued_at: new Date().toISOString(),
      paid_at: new Date().toISOString(),
      payment_method: 'manual_offline',
      payment_reference: reference,
      line_items: [{ description, amount: Math.abs(numericAmount) }],
    })
    .select('*')
    .single();
  if (error) throw new BadRequestError(error.message);

  await supabaseAdmin.from('subscription_events').insert({
    company_subscription_id: subscription.id,
    event_type: 'created',
    triggered_by: 'super_admin',
    triggered_by_user_id: actorId,
    metadata: { manualInvoice: true, amount: numericAmount, description, reference },
  });

  return invoice;
};

const PAYMENT_METHODS = ['bank_transfer', 'cheque', 'cash', 'other'];

/**
 * Item 4: reconciles an OFFLINE payment against an EXISTING invoice
 * (pending/draft/failed/partially_paid) — distinct from issueManualInvoice
 * (creates a brand-new already-paid invoice) and issueManualCredit
 * (reduces amount owed via a negative invoice). This is the missing third
 * case: an invoice already exists and a real payment came in for it
 * afterward, with no payment gateway to auto-reconcile it.
 *
 * amountReceived defaults to the invoice's remaining balance; a caller may
 * pass a different amount (partial payment, or an adjustment), which
 * requires `note` to explain the mismatch. Less than the remaining balance
 * leaves the invoice in 'partially_paid' rather than 'paid' and keeps
 * amount_paid running so a later top-up payment can be recorded against
 * the same invoice. Deliberately does NOT touch company_billing_
 * subscriptions.status — the login-gate/export-gate logic (auth.service.js,
 * exportGate.service.js) only ever reads subscription status, never
 * invoice status, so a partially_paid invoice is already treated exactly
 * like an unpaid one there with zero code change needed.
 */
const recordInvoicePayment = async (invoiceId, { paymentMethod, reference, amountReceived, note } = {}, actorId) => {
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    throw new BadRequestError(`payment_method must be one of ${PAYMENT_METHODS.join(', ')}`);
  }
  if (!reference || !String(reference).trim()) throw new BadRequestError('A reference/note is required');

  const { data: invoice, error: invError } = await supabaseAdmin
    .from('subscription_invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle();
  if (invError) throw new BadRequestError(invError.message);
  if (!invoice) throw new NotFoundError('Invoice not found');
  if (['paid', 'refunded', 'void'].includes(invoice.status)) {
    throw new ConflictError(`Invoice is already ${invoice.status} — nothing to record`);
  }

  const remaining = Number(invoice.amount) - Number(invoice.amount_paid || 0);
  const amount = amountReceived != null ? Number(amountReceived) : remaining;
  if (!amount || amount <= 0) throw new BadRequestError('A positive amount received is required');
  // Overpayment cap: previously only a mismatch from `remaining` required a
  // note, it didn't reject an amount that exceeds the outstanding balance —
  // a typo (extra zero) could silently record an amount far beyond what's
  // owed. A genuine overpayment/goodwill credit should go through
  // issueManualCredit instead, which is explicit about what it's doing.
  if (amount > remaining + 0.01) {
    throw new BadRequestError(
      `Amount received (${amount}) exceeds the outstanding balance (${remaining}). Record up to the balance, or use a manual credit for anything beyond that.`
    );
  }
  if (amount !== remaining && !String(note || '').trim()) {
    throw new BadRequestError(
      `Amount received (${amount}) does not match the outstanding balance (${remaining}) — a note explaining the difference is required`
    );
  }

  const newAmountPaid = Number(invoice.amount_paid || 0) + amount;
  const fullyPaid = newAmountPaid >= Number(invoice.amount);
  const newStatus = fullyPaid ? 'paid' : 'partially_paid';

  // Optimistic concurrency: the WHERE clause is conditioned on the exact
  // amount_paid/status this calculation was based on, not just the invoice
  // id. Two concurrent recordings (two admins, or a double-click) both read
  // the same starting amount_paid — only the first UPDATE's guard still
  // matches by the time it runs; the second matches zero rows and gets a
  // clear "someone already recorded a payment" error instead of silently
  // overwriting the first payment's amount_paid/reference with its own.
  const { data: updated, error } = await supabaseAdmin
    .from('subscription_invoices')
    .update({
      status: newStatus,
      amount_paid: newAmountPaid,
      paid_at: fullyPaid ? new Date().toISOString() : invoice.paid_at,
      payment_method: paymentMethod,
      payment_reference: reference,
    })
    .eq('id', invoiceId)
    .eq('amount_paid', invoice.amount_paid || 0)
    .eq('status', invoice.status)
    .select('*')
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!updated) {
    throw new ConflictError('This invoice was just updated by another action — refresh and try again.');
  }

  await supabaseAdmin.from('subscription_events').insert({
    company_subscription_id: invoice.company_subscription_id,
    event_type: fullyPaid ? 'payment_recovered' : 'created',
    triggered_by: 'super_admin',
    triggered_by_user_id: actorId,
    metadata: {
      manualPaymentRecorded: true, invoiceId, paymentMethod, reference,
      amountReceived: amount, newStatus, remainingBefore: remaining, note: note || null,
    },
  });

  return updated;
};

/**
 * Pushes out current_period_end / next_renewal_date without creating an
 * invoice or touching status — a distinct concern from renewal (which
 * always bills) and from credit (which only ever adjusts amount owed).
 * Exactly one of daysToAdd / explicitEndDate is expected; explicitEndDate
 * wins if both are somehow passed.
 */
const extendSubscription = async (companyId, { daysToAdd, explicitEndDate }, reason, actorId) => {
  if (!reason || !String(reason).trim()) throw new BadRequestError('A reason is required to extend a subscription');
  if (!daysToAdd && !explicitEndDate) throw new BadRequestError('Either days or an explicit end date is required');

  const { data: subscription, error: subError } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('id, current_period_end, next_renewal_date')
    .eq('company_id', companyId)
    .in('status', ['trialing', 'active', 'past_due', 'grace_period', 'suspended'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subError) throw new BadRequestError(subError.message);
  if (!subscription) throw new NotFoundError('This company has no subscription to extend');

  const currentEnd = new Date(subscription.current_period_end);
  let newEnd;
  if (explicitEndDate) {
    newEnd = new Date(explicitEndDate);
    if (Number.isNaN(newEnd.getTime())) throw new BadRequestError('Invalid end date');
    if (newEnd <= currentEnd) throw new BadRequestError('The new end date must be after the current renewal date');
  } else {
    const days = Number(daysToAdd);
    if (!Number.isInteger(days) || days <= 0) throw new BadRequestError('days must be a positive whole number');
    newEnd = new Date(currentEnd.getTime() + days * 24 * 60 * 60 * 1000);
  }

  const { data: updated, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .update({
      current_period_end: newEnd.toISOString(),
      next_renewal_date: newEnd.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscription.id)
    .select('*, plans:subscription_plans(*), companies(id, name, slug)')
    .single();
  if (error) throw new BadRequestError(error.message);

  await supabaseAdmin.from('subscription_events').insert({
    company_subscription_id: subscription.id,
    event_type: 'manual_extension',
    triggered_by: 'super_admin',
    triggered_by_user_id: actorId,
    metadata: { previousEnd: subscription.current_period_end, newEnd: newEnd.toISOString(), reason },
  });

  return updated;
};

module.exports = {
  cohortRetention, listFailedPayments, retryFailedPayment, issueManualCredit, issueManualInvoice,
  recordInvoicePayment, extendSubscription,
};
