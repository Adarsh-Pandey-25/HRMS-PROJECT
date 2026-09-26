const { supabaseAdmin } = require('../config/supabase');
const authService = require('../services/auth.service');
const { successResponse } = require('../utils/helpers');
const { BadRequestError, ForbiddenError, NotFoundError } = require('../utils/errors');
const { uploadProfilePicture, getSignedUrl, STORAGE_BUCKETS } = require('../services/storage.service');

const getCompanyName = async (companyId) => {
  const settingsService = require('../services/settings.service');
  const profile = await settingsService.getSetting('company_profile', {}, companyId);
  if (profile?.name) return profile.name;
  const { data } = await supabaseAdmin
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .maybeSingle();
  return data?.name || 'Company';
};

const getMe = async (req, res, next) => {
  try {
    const employeeId = req.onboardingEmployee.id;
    const { data, error } = await supabaseAdmin
      .from('employees')
      .select('first_name, last_name, email, phone, date_of_birth, gender, address, emergency_contact, bank_details, profile_picture, department, designation, role, date_of_joining, onboarding_completed, company_id')
      .eq('id', employeeId)
      .maybeSingle();

    if (error) throw new BadRequestError(error.message);
    if (!data) throw new NotFoundError('Employee not found');

    const companyName = await getCompanyName(data.company_id);
    const addr = data.address && typeof data.address === 'object' ? data.address : {};
    let profilePicture = null;
    if (data.profile_picture) {
      try {
        profilePicture = await getSignedUrl(STORAGE_BUCKETS.profilePictures, data.profile_picture, 3600);
      } catch { /* preview only */ }
    }

    successResponse(res, 'Onboarding data fetched', {
      ...data,
      profile_picture: profilePicture,
      // Only the postal fields — address JSON also carries internal keys
      // (company_id, attendance_mode, shift) the employee must not see or edit.
      address: {
        street: addr.street || '',
        city: addr.city || '',
        state: addr.state || '',
        pincode: addr.pincode || '',
      },
      company_name: companyName,
    });
  } catch (err) { next(err); }
};

const complete = async (req, res, next) => {
  try {
    const employeeId = req.onboardingEmployee.id;
    const body = req.body || {};
    const updates = {};

    if (body.phone_number) updates.phone = String(body.phone_number).trim();
    if (body.date_of_birth) updates.date_of_birth = body.date_of_birth;
    if (body.gender) updates.gender = body.gender;
    if (body.address) {
      // Merge, don't replace: the address JSON also holds company_id,
      // attendance_mode and shift set by HR.
      const { data: current } = await supabaseAdmin
        .from('employees')
        .select('address')
        .eq('id', employeeId)
        .maybeSingle();
      const existing = current?.address && typeof current.address === 'object' ? current.address : {};
      updates.address = {
        ...existing,
        street: String(body.address.street || '').trim(),
        city: String(body.address.city || '').trim(),
        state: String(body.address.state || '').trim(),
        pincode: String(body.address.pincode || '').trim(),
      };
    }
    if (body.emergency_contact) {
      updates.emergency_contact = {
        name: String(body.emergency_contact.name || '').trim(),
        phone: String(body.emergency_contact.phone || '').trim(),
      };
    }
    if (body.bank_details) {
      updates.bank_details = {
        bank_name: body.bank_details.bank_name || '',
        account_number: String(body.bank_details.account_number || '').trim(),
        ifsc_code: String(body.bank_details.ifsc_code || '').trim().toUpperCase(),
        account_holder_name: body.bank_details.account_holder_name || '',
      };
    }

    if (!body.password) {
      throw new BadRequestError('New password is required to complete onboarding');
    }

    const { validatePassword } = require('../utils/passwordStrength');
    validatePassword(body.password, BadRequestError);

    const passwordHash = await authService.hashPassword(body.password);
    updates.password_hash = passwordHash;
    updates.must_change_password = false;
    updates.onboarding_completed = true;
    updates.onboarding_completed_at = new Date().toISOString();
    updates.onboarding_token_used = true;
    updates.temp_password_expires_at = null;

    // Conditional on not-yet-completed so two concurrent submits with the
    // same link can't both succeed.
    const { data, error } = await supabaseAdmin
      .from('employees')
      .update(updates)
      .eq('id', employeeId)
      .eq('onboarding_completed', false)
      .select('id, email, first_name, last_name')
      .maybeSingle();

    if (error) throw new BadRequestError(error.message);
    if (!data) throw new ForbiddenError('Onboarding already completed. You can log in normally.');

    successResponse(res, 'Onboarding complete. You can now log in with your new password.', {
      employee: { id: data.id, email: data.email, first_name: data.first_name, last_name: data.last_name },
    });
  } catch (err) { next(err); }
};

const uploadPhoto = async (req, res, next) => {
  try {
    const employeeId = req.onboardingEmployee.id;
    if (!req.file) {
      throw new BadRequestError('Photo file is required');
    }

    // Same as employee.controller.js uploadPhoto: store the storage path,
    // hand the browser a short-lived signed URL to preview it.
    const { path } = await uploadProfilePicture(req.file, employeeId);
    await supabaseAdmin
      .from('employees')
      .update({ profile_picture: path })
      .eq('id', employeeId);

    const photoUrl = await getSignedUrl(STORAGE_BUCKETS.profilePictures, path, 3600);
    successResponse(res, 'Photo uploaded successfully', { photoUrl });
  } catch (err) { next(err); }
};

module.exports = { getMe, complete, uploadPhoto };
