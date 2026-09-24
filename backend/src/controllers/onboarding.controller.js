const { supabaseAdmin } = require('../config/supabase');
const authService = require('../services/auth.service');
const { successResponse } = require('../utils/helpers');
const { BadRequestError, ForbiddenError, UnauthorizedError, NotFoundError } = require('../utils/errors');
const { uploadProfilePicture } = require('../services/storage.service');
const { authenticateOnboarding } = require('../middleware/authenticateOnboarding.middleware');

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
      .select('first_name, last_name, email, phone, date_of_birth, gender, address, emergency_contact, bank_details, pan_number, aadhar_number, profile_picture, department, designation, role, date_of_joining, onboarding_completed, company_id')
      .eq('id', employeeId)
      .maybeSingle();

    if (error) throw new BadRequestError(error.message);
    if (!data) throw new NotFoundError('Employee not found');

    const companyName = await getCompanyName(data.company_id);
    const onboardingLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/onboarding?token=${req.query.token || ''}`;

    successResponse(res, 'Onboarding data fetched', {
      ...data,
      onboarding_link: onboardingLink,
      company_name: companyName,
    });
  } catch (err) { next(err); }
};

const complete = async (req, res, next) => {
  try {
    const employeeId = req.onboardingEmployee.id;
    const body = req.body || {};
    const updates = {};

    if (body.phone_number !== undefined) updates.phone = String(body.phone_number).trim();
    if (body.date_of_birth !== undefined) updates.date_of_birth = body.date_of_birth;
    if (body.gender !== undefined) updates.gender = body.gender;
    if (body.address) {
      updates.address = {
        street: body.address.street || '',
        city: body.address.city || '',
        state: body.address.state || '',
        pincode: body.address.pincode || '',
      };
    }
    if (body.emergency_contact) {
      updates.emergency_contact = {
        name: body.emergency_contact.name || '',
        phone: body.emergency_contact.phone || '',
      };
    }
    if (body.pan_number !== undefined) updates.pan_number = String(body.pan_number).trim() || null;
    if (body.aadhar_number !== undefined) updates.aadhar_number = String(body.aadhar_number).trim() || null;
    if (body.bank_details) {
      updates.bank_details = {
        bank_name: body.bank_details.bank_name || '',
        account_number: body.bank_details.account_number || '',
        ifsc_code: body.bank_details.ifsc_code || '',
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

    const { data, error } = await supabaseAdmin
      .from('employees')
      .update(updates)
      .eq('id', employeeId)
      .select()
      .single();

    if (error) throw new BadRequestError(error.message);

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

    const result = await uploadProfilePicture(req.file, employeeId);
    const photoUrl = result?.publicUrl || result?.path || '';

    if (!photoUrl) {
      throw new BadRequestError('Photo upload failed — no URL returned');
    }

    await supabaseAdmin
      .from('employees')
      .update({ profile_picture: photoUrl })
      .eq('id', employeeId);

    successResponse(res, 'Photo uploaded successfully', { photoUrl });
  } catch (err) { next(err); }
};

module.exports = { getMe, complete, uploadPhoto };
