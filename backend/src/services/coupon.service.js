const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');
const logger = require('../utils/logger');

const listCoupons = async () => {
  const { data, error } = await supabaseAdmin.from('coupons').select('*').order('created_at', { ascending: false });
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const createCoupon = async (createdBy, {
  code, discountType, discountValue, validFrom, validUntil, maxRedemptions, applicablePlanIds,
}) => {
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode) throw new BadRequestError('Coupon code is required');
  if (!['percent', 'flat'].includes(discountType)) throw new BadRequestError('discount_type must be percent or flat');
  const value = Number(discountValue);
  if (!value || value <= 0) throw new BadRequestError('discount_value must be a positive number');
  if (discountType === 'percent' && value > 100) throw new BadRequestError('A percent discount cannot exceed 100');

  const { data, error } = await supabaseAdmin
    .from('coupons')
    .insert({
      code: cleanCode,
      discount_type: discountType,
      discount_value: value,
      valid_from: validFrom || new Date().toISOString(),
      valid_until: validUntil || null,
      max_redemptions: maxRedemptions || null,
      applicable_plan_ids: applicablePlanIds || null,
      created_by: createdBy,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new ConflictError('A coupon with this code already exists');
    throw new BadRequestError(error.message);
  }
  return data;
};

const deactivateCoupon = async (id) => {
  const { data, error } = await supabaseAdmin
    .from('coupons')
    .update({ is_active: false })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Coupon not found');
  return data;
};

const getCouponOrThrow = async (id) => {
  const { data, error } = await supabaseAdmin.from('coupons').select('*').eq('id', id).maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Coupon not found');
  return data;
};

const validateForRedemption = async (coupon, planId) => {
  const now = new Date();
  if (!coupon.is_active) throw new ConflictError('This coupon is no longer active');
  if (new Date(coupon.valid_from) > now) throw new ConflictError('This coupon is not yet valid');
  if (coupon.valid_until && new Date(coupon.valid_until) < now) throw new ConflictError('This coupon has expired');
  if (coupon.max_redemptions != null && coupon.times_redeemed >= coupon.max_redemptions) {
    throw new ConflictError('This coupon has reached its redemption limit');
  }
  if (coupon.applicable_plan_ids && Array.isArray(coupon.applicable_plan_ids) && coupon.applicable_plan_ids.length > 0) {
    if (!coupon.applicable_plan_ids.includes(planId)) {
      throw new ConflictError('This coupon does not apply to the selected plan');
    }
  }
};

const applyDiscount = (amount, coupon) => {
  const value = coupon.discount_type === 'percent'
    ? amount * (Number(coupon.discount_value) / 100)
    : Number(coupon.discount_value);
  return Math.max(0, Math.round((amount - value) * 100) / 100);
};

/**
 * Optional step hooked into subscription creation/renewal — does not change
 * either function's existing signature (see createSubscription/renewSubscription
 * in subscription.service.js, called with couponCode as an extra optional arg).
 * Split into fetch+validate (called before the price is locked in) and
 * recordRedemption (called after the invoice actually exists to attach to).
 */
const fetchValidCoupon = async (couponCode, planId) => {
  if (!couponCode) return null;
  const { data: coupon, error } = await supabaseAdmin
    .from('coupons')
    .select('*')
    .eq('code', String(couponCode).trim().toUpperCase())
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!coupon) throw new NotFoundError('Invalid coupon code');
  await validateForRedemption(coupon, planId);
  return coupon;
};

/**
 * Optimistic-concurrency guard: two near-simultaneous redemptions both
 * passing validateForRedemption's times_redeemed check (both read the same
 * stale count) would otherwise both increment from that same stale value,
 * silently under-counting and letting the coupon go one redemption past
 * max_redemptions. `.eq('times_redeemed', coupon.times_redeemed)` makes
 * only the first writer's update actually match; the second matches zero
 * rows. This is called after the invoice already exists (see
 * subscription.service.js) with no shared transaction across the two, so a
 * hard throw here would abort subscription creation with the invoice
 * already committed — logged instead of thrown, accepting the narrow,
 * safe-direction race window (an undercounted redemption, never a
 * corrupted one) over a worse partial-failure state. True atomicity would
 * need a DB-side increment (RPC/transaction), not available through this
 * REST client without direct DDL access.
 */
const recordRedemption = async (coupon, companyId, invoiceId) => {
  if (!coupon) return;
  const { data: updated, error } = await supabaseAdmin
    .from('coupons')
    .update({ times_redeemed: coupon.times_redeemed + 1 })
    .eq('id', coupon.id)
    .eq('times_redeemed', coupon.times_redeemed)
    .select('id')
    .maybeSingle();
  if (error) {
    logger.error('[Coupon] Failed to record redemption count', { couponId: coupon.id, error: error.message });
  } else if (!updated) {
    logger.warn('[Coupon] Concurrent redemption detected — times_redeemed not incremented this time', { couponId: coupon.id, companyId });
  }
  await supabaseAdmin.from('company_coupon_redemptions').insert({
    company_id: companyId, coupon_id: coupon.id, applied_to_invoice_id: invoiceId || null,
  });
};

module.exports = {
  listCoupons, createCoupon, deactivateCoupon, getCouponOrThrow, applyDiscount, fetchValidCoupon, recordRedemption,
};
