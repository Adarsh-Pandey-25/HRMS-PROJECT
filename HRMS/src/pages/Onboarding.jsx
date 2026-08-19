import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, CheckCircle2, Rocket, Send, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Input, Select, Stepper, FileUpload } from '../components/ui';
import { AddressFields, EmergencyContactFields } from '../components/shared/ContactDetailFields';
import { PageLoader } from '../components/layout/PageLoader';
import { useCompanyStore } from '../store/companyStore';
import { INDUSTRIES, COMPANY_SIZES } from '../lib/constants';
import {
  bootstrapAdminApi,
  peekOnboardingInviteApi,
  sendOnboardingOtpApi,
  verifyOnboardingOtpApi,
} from '../api/auth.api';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';

const STEPS = [
  { label: 'Company' },
  { label: 'Contact' },
  { label: 'Brand' },
  { label: 'Admin' },
  { label: 'Import' },
  { label: 'Review' },
];

const nameRegex = /^[A-Za-z][A-Za-z\s.'-]*$/;
const phoneRegex = /^\d{10}$/;
const pincodeRegex = /^\d{6}$/;
const companyNameRegex = /^[A-Za-z][A-Za-z\s.'&,()-]*$/;
const currentYear = new Date().getFullYear();

const schema = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, 'Required')
    .regex(companyNameRegex, 'Company name must contain letters only (no numbers)'),
  industry: z.string().min(1, 'Required'),
  companySize: z.string().min(1, 'Required'),
  foundedYear: z
    .string()
    .trim()
    .min(1, 'Required')
    .regex(/^\d{4}$/, 'Enter a 4-digit year')
    .refine((y) => {
      const n = Number(y);
      return n >= 1800 && n <= currentYear;
    }, `Year must be between 1800 and ${currentYear}`),
  website: z
    .string()
    .trim()
    .min(1, 'Required')
    .url('Enter a valid URL (e.g. https://www.company.com)'),

  addressLine1: z.string().trim().min(1, 'Required'),
  addressLine2: z.string().trim().min(1, 'Required'),
  city: z.string().trim().min(1, 'Required').regex(nameRegex, 'City must contain letters only'),
  state: z.string().trim().min(1, 'Required').regex(nameRegex, 'State must contain letters only'),
  pincode: z.string().trim().regex(pincodeRegex, 'Pincode must be exactly 6 digits'),
  country: z.string().trim().min(1, 'Required').regex(nameRegex, 'Country must contain letters only'),
  contactName: z
    .string()
    .trim()
    .min(1, 'Required')
    .regex(nameRegex, 'Name must contain letters only (no numbers)'),
  contactEmail: z
    .string()
    .trim()
    .min(1, 'Required')
    .email('Enter a valid email (e.g. name@company.com)'),
  contactPhone: z
    .string()
    .trim()
    .regex(phoneRegex, 'Phone number must be exactly 10 digits'),

  emergencyName: z
    .string()
    .trim()
    .min(1, 'Required')
    .regex(nameRegex, 'Name must contain letters only (no numbers)'),
  emergencyPhone: z
    .string()
    .trim()
    .regex(phoneRegex, 'Phone number must be exactly 10 digits'),
  emergencyRelation: z
    .string()
    .trim()
    .min(1, 'Required')
    .regex(nameRegex, 'Relation must contain letters only'),

  brandColor: z
    .string()
    .min(1, 'Required')
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Enter a valid color (e.g. #6C63FF)'),
  tagline: z.string().trim().min(1, 'Required'),

  adminName: z
    .string()
    .trim()
    .min(1, 'Required')
    .regex(nameRegex, 'Name must contain letters only (no numbers)'),
  adminEmail: z
    .string()
    .trim()
    .min(1, 'Required')
    .email('Enter a valid email (e.g. name@company.com)'),
});

const STEP_FIELDS = [
  ['companyName', 'industry', 'companySize', 'foundedYear', 'website'],
  ['addressLine1', 'addressLine2', 'city', 'state', 'pincode', 'country', 'contactName', 'contactEmail', 'contactPhone', 'emergencyName', 'emergencyPhone', 'emergencyRelation'],
  ['brandColor', 'tagline'],
  ['adminName', 'adminEmail'],
  [],
  [],
];

const EMPTY_ONBOARDING = {
  companyName: '',
  industry: '',
  companySize: '',
  foundedYear: '',
  website: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  pincode: '',
  country: 'India',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  emergencyName: '',
  emergencyPhone: '',
  emergencyRelation: '',
  brandColor: '#6C63FF',
  tagline: '',
  adminName: '',
  adminEmail: '',
};

export default function Onboarding() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteToken = (searchParams.get('invite') || '').trim();
  const completeOnboarding = useCompanyStore((s) => s.completeOnboarding);
  const [inviteStatus, setInviteStatus] = useState(inviteToken ? 'loading' : 'missing');
  const [inviteMeta, setInviteMeta] = useState(null);
  const [step, setStep] = useState(0);
  const [logoFile, setLogoFile] = useState(null);
  const [otp, setOtp] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [verificationToken, setVerificationToken] = useState('');
  const [resendUntil, setResendUntil] = useState(0);
  const [resendLeft, setResendLeft] = useState(0);
  const [launching, setLaunching] = useState(false);

  const {
    register, handleSubmit, trigger, watch, setValue, formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_ONBOARDING,
  });

  const values = watch();
  const adminEmail = values.adminEmail;

  useEffect(() => {
    if (!inviteToken) {
      setInviteStatus('missing');
      return undefined;
    }
    let cancelled = false;
    setInviteStatus('loading');
    (async () => {
      try {
        const data = await peekOnboardingInviteApi(inviteToken);
        if (cancelled) return;
        setInviteMeta(data);
        if (data?.email) setValue('adminEmail', data.email);
        if (data?.companyNameHint || data?.company_name_hint) {
          setValue('companyName', data.companyNameHint || data.company_name_hint);
        }
        setInviteStatus('valid');
      } catch (err) {
        if (!cancelled) {
          setInviteStatus('invalid');
          setInviteMeta({ message: err.message || 'This invite link is invalid or expired' });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [inviteToken, setValue]);

  useEffect(() => {
    if (resendUntil <= Date.now()) {
      setResendLeft(0);
      return undefined;
    }
    const tick = () => setResendLeft(Math.max(0, Math.ceil((resendUntil - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [resendUntil]);

  // Reset OTP state if admin email changes after verification
  useEffect(() => {
    setOtp('');
    setOtpSent(false);
    setEmailVerified(false);
    setVerificationToken('');
  }, [adminEmail]);

  useEffect(() => {
    if (inviteStatus !== 'valid') return undefined;
    if (step !== 5 || !adminEmail || otpSent || emailVerified) return undefined;
    let cancelled = false;
    (async () => {
      setOtpSending(true);
      try {
        const data = await sendOnboardingOtpApi(adminEmail, values.adminName, inviteToken);
        if (cancelled) return;
        setOtpSent(true);
        if (data?.nextResendAt) setResendUntil(Number(data.nextResendAt));
        else if (data?.retryAfterSeconds) setResendUntil(Date.now() + Number(data.retryAfterSeconds) * 1000);
        toast.success(`OTP sent to ${adminEmail}`);
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Could not send OTP');
      } finally {
        if (!cancelled) setOtpSending(false);
      }
    })();
    return () => { cancelled = true; };
  }, [step, adminEmail, inviteStatus, inviteToken]);

  const handleNameInput = (e) => {
    e.target.value = e.target.value.replace(/[^A-Za-z\s.'-]/g, '');
  };

  const handlePhoneInput = (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
  };

  const handlePincodeInput = (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  };

  const handleYearInput = (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  };

  const next = async () => {
    const valid = await trigger(STEP_FIELDS[step]);
    if (valid) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const sendOtp = async () => {
    if (!adminEmail) return toast.error('Admin email is required');
    if (resendLeft > 0) return toast.error(`Wait ${resendLeft}s before resending`);
    setOtpSending(true);
    try {
      const data = await sendOnboardingOtpApi(adminEmail, values.adminName, inviteToken);
      setOtpSent(true);
      setEmailVerified(false);
      setVerificationToken('');
      setOtp('');
      if (data?.nextResendAt) setResendUntil(Number(data.nextResendAt));
      else if (data?.retryAfterSeconds) setResendUntil(Date.now() + Number(data.retryAfterSeconds) * 1000);
      toast.success(`OTP sent to ${adminEmail}`);
    } catch (err) {
      const details = err?.details;
      if (details?.nextResendAt) setResendUntil(Number(details.nextResendAt));
      else if (details?.retryAfterSeconds) setResendUntil(Date.now() + Number(details.retryAfterSeconds) * 1000);
      toast.error(err.message || 'Could not send OTP');
    } finally {
      setOtpSending(false);
    }
  };

  const verifyOtp = async () => {
    if (!otp || otp.length < 4) return toast.error('Enter the 6-digit OTP');
    setOtpVerifying(true);
    try {
      const data = await verifyOnboardingOtpApi(adminEmail, otp);
      setVerificationToken(data?.verificationToken || '');
      setEmailVerified(true);
      toast.success('Email verified');
    } catch (err) {
      setEmailVerified(false);
      setVerificationToken('');
      toast.error(err.message || 'Invalid OTP');
    } finally {
      setOtpVerifying(false);
    }
  };

  const onSubmit = async (data) => {
    if (!emailVerified || !verificationToken) {
      return toast.error('Verify the OTP sent to your admin email before launching');
    }
    // eslint-disable-next-line no-unused-vars
    const { companyName, companySize, ...rest } = data;

    setLaunching(true);
    try {
      const admin = await bootstrapAdminApi({
        admin_name: data.adminName,
        admin_email: data.adminEmail,
        email: data.adminEmail,
        verificationToken,
        inviteToken,
        company_profile: {
          name: companyName,
          industry: data.industry,
          size: companySize,
          foundedYear: data.foundedYear,
          website: data.website,
          addressLine1: data.addressLine1,
          addressLine2: data.addressLine2,
          city: data.city,
          state: data.state,
          pincode: data.pincode,
          country: data.country,
          contactName: data.contactName,
          contactEmail: data.contactEmail,
          contactPhone: data.contactPhone,
          emergencyName: data.emergencyName,
          emergencyPhone: data.emergencyPhone,
          emergencyRelation: data.emergencyRelation,
          brandColor: data.brandColor,
          tagline: data.tagline,
          adminName: data.adminName,
          adminEmail: data.adminEmail,
        },
      }, logoFile);

      completeOnboarding({
        ...rest,
        name: companyName,
        size: companySize,
        logoName: logoFile?.name || null,
        adminName: data.adminName,
        adminEmail: data.adminEmail,
        companyId: admin?.companyId || admin?.company_id || null,
      });

      // End any previous company session so Launch does not bounce to the old dashboard.
      await useAuthStore.getState().logout({ silent: false });
      try {
        useSettingsStore.persist?.clearStorage?.();
      } catch {
        /* optional */
      }

      toast.success(`${companyName} is live — check your email for the admin password, then sign in`);
      navigate('/login', {
        replace: true,
        state: {
          justOnboarded: true,
          email: data.adminEmail,
          companyName,
        },
      });
    } catch (err) {
      toast.error(err.message || 'Could not create company workspace');
    } finally {
      setLaunching(false);
    }
  };

  if (inviteStatus === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <PageLoader />
      </div>
    );
  }

  if (inviteStatus !== 'valid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page px-4">
        <Card className="w-full max-w-md p-8 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-danger/10 text-danger flex items-center justify-center">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-fg">Invite required</h1>
          <p className="mt-2 text-sm text-fg-muted">
            {inviteStatus === 'missing'
              ? 'Company onboarding is invite-only. Ask your platform administrator for a one-time link.'
              : (inviteMeta?.message || 'This invite link is invalid, used, or expired.')}
          </p>
          <Button className="mt-6 w-full" onClick={() => navigate('/login')}>
            Go to company sign in
          </Button>
          <p className="mt-3 text-xs text-fg-subtle">
            Already have a workspace? <Link to="/login" className="text-primary hover:underline">Sign in</Link>
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page py-10 px-4">
      <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
        <div className="text-center">
          <h1 className="text-page-title text-fg">Set up your company workspace</h1>
          <p className="mt-1 text-sm text-fg-muted">A few details and you're ready to launch.</p>
          {(inviteMeta?.companyNameHint || inviteMeta?.company_name_hint) && (
            <p className="mt-2 text-xs text-fg-subtle">
              Invite for {inviteMeta.companyNameHint || inviteMeta.company_name_hint}
            </p>
          )}
        </div>

        <Card className="p-6">
          <Stepper steps={STEPS} current={step} />
        </Card>

        <form onSubmit={handleSubmit(onSubmit)}>
          <Card>
            <CardHeader title={STEPS[step].label} subtitle={`Step ${step + 1} of ${STEPS.length}`} />
            <div className="p-6 pt-4">
              {/* Step 1 — Company Details */}
              {step === 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Company name"
                    required
                    placeholder="e.g. Acme Technologies Pvt. Ltd."
                    containerClass="sm:col-span-2"
                    readOnly
                    {...register('companyName')}
                    error={errors.companyName?.message}
                    hint="Locked to the company name on your invitation"
                  />
                  <Select label="Industry" required placeholder="Select industry" options={INDUSTRIES} {...register('industry')} error={errors.industry?.message} />
                  <Select label="Company size" required placeholder="Select size" options={COMPANY_SIZES} {...register('companySize')} error={errors.companySize?.message} />
                  <Input
                    label="Founded year"
                    required
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="e.g. 2019"
                    {...register('foundedYear')}
                    onInput={handleYearInput}
                    error={errors.foundedYear?.message}
                  />
                  <Input
                    label="Website URL"
                    required
                    type="url"
                    placeholder="https://www.company.com"
                    {...register('website')}
                    error={errors.website?.message}
                  />
                </div>
              )}

              {/* Step 2 — Contact & Location */}
              {step === 1 && (
                <div className="space-y-6">
                  <AddressFields
                    register={register}
                    errors={errors}
                    required
                    onPincodeInput={handlePincodeInput}
                    onLettersInput={handleNameInput}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border/60">
                    <Input
                      label="Primary contact name"
                      required
                      placeholder="e.g. Riya Sharma"
                      {...register('contactName')}
                      onInput={handleNameInput}
                      error={errors.contactName?.message}
                    />
                    <Input
                      label="Primary contact email"
                      type="email"
                      inputMode="email"
                      required
                      placeholder="e.g. riya.sharma@company.com"
                      {...register('contactEmail')}
                      error={errors.contactEmail?.message}
                    />
                    <Input
                      label="Primary contact phone"
                      required
                      placeholder="e.g. 9876543210"
                      containerClass="sm:col-span-2"
                      inputMode="numeric"
                      maxLength={10}
                      {...register('contactPhone')}
                      onInput={handlePhoneInput}
                      error={errors.contactPhone?.message}
                    />
                  </div>
                  <div className="pt-2 border-t border-border/60">
                    <EmergencyContactFields
                      register={register}
                      errors={errors}
                      required
                      onPhoneInput={handlePhoneInput}
                      onNameInput={handleNameInput}
                    />
                  </div>
                </div>
              )}

              {/* Step 3 — Brand & Identity */}
              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <p className="text-xs font-medium text-fg-muted mb-1.5">Company logo</p>
                    <FileUpload
                      accept=".png,.jpg,.jpeg"
                      multiple={false}
                      maxSizeMB={2}
                      hint="PNG or JPG · up to 2MB"
                      value={logoFile}
                      onChange={(files) => setLogoFile(files[0] || null)}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-fg-muted">
                        Primary brand color <span className="text-danger">*</span>
                      </label>
                      <div className="flex items-center gap-2.5">
                        <input
                          type="color"
                          className="h-10 w-12 rounded-input border border-border bg-card cursor-pointer"
                          {...register('brandColor')}
                        />
                        <Input
                          className="flex-1"
                          placeholder="#6C63FF"
                          value={values.brandColor}
                          onChange={(e) => setValue('brandColor', e.target.value, { shouldValidate: true })}
                          error={errors.brandColor?.message}
                        />
                      </div>
                    </div>
                    <Input
                      label="Company tagline"
                      required
                      placeholder="e.g. Modern HR, simplified."
                      {...register('tagline')}
                      error={errors.tagline?.message}
                    />
                  </div>
                </div>
              )}

              {/* Step 4 — Admin Account Setup */}
              {step === 3 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Admin full name"
                    required
                    placeholder="e.g. Riya Sharma"
                    containerClass="sm:col-span-2"
                    {...register('adminName')}
                    onInput={handleNameInput}
                    error={errors.adminName?.message}
                  />
                  <Input
                    label="Admin work email"
                    type="email"
                    inputMode="email"
                    required
                    placeholder="e.g. riya.sharma@company.com"
                    containerClass="sm:col-span-2"
                    readOnly={Boolean(inviteMeta?.email)}
                    {...register('adminEmail')}
                    error={errors.adminEmail?.message}
                    hint={inviteMeta?.email ? 'Locked to the email on this invite' : undefined}
                  />
                  <p className="sm:col-span-2 text-xs text-fg-subtle">
                    After launch, a temporary password is emailed to the admin address. It is never shown in the browser.
                  </p>
                </div>
              )}

              {/* Step 5 — Import Employees (after launch — needs auth) */}
              {step === 4 && (
                <div className="space-y-4">
                  <p className="text-sm text-fg-muted">
                    Employee import needs a signed-in admin, so it runs after you launch.
                    Skip for now — you can bulk-import from <span className="font-medium text-fg">Employees → Bulk Import</span> once you sign in.
                  </p>
                  <div className="rounded-input border border-border bg-muted/40 p-4 text-sm text-fg-muted">
                    Your new company workspace starts empty. Only people you add (or import) after login will appear — not employees from other companies.
                  </div>
                  <div className="flex justify-end">
                    <Button type="button" onClick={() => setStep(5)} icon={ArrowRight} className="flex-row-reverse">
                      Continue to review
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 6 — Review & Confirm */}
              {step === 5 && (
                <div className="space-y-4">
                  {[
                    ['Company', [
                      ['Name', values.companyName], ['Industry', values.industry], ['Size', values.companySize],
                      ['Founded', values.foundedYear || '—'], ['Website', values.website || '—'],
                    ]],
                    ['Contact & Location', [
                      ['Address', [values.addressLine1, values.addressLine2, values.city, values.state, values.pincode, values.country].filter(Boolean).join(', ')],
                      ['Contact', `${values.contactName} · ${values.contactEmail} · ${values.contactPhone}`],
                      ['Emergency', [values.emergencyName, values.emergencyPhone, values.emergencyRelation].filter(Boolean).join(' · ') || '—'],
                    ]],
                    ['Brand', [
                      ['Logo', logoFile?.name || 'Not uploaded'], ['Brand color', values.brandColor], ['Tagline', values.tagline || '—'],
                    ]],
                    ['Admin account', [
                      ['Name', values.adminName],
                      ['Email', values.adminEmail],
                      ['Password', 'Sent by email after launch'],
                    ]],
                    ['Employees', [
                      ['Directory', 'Empty until you add or import after login'],
                    ]],
                  ].map(([section, rows]) => (
                    <div key={section} className="rounded-input border border-border p-4">
                      <p className="text-sm font-semibold text-fg mb-2.5">{section}</p>
                      <div className="space-y-1.5">
                        {rows.map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-4 text-sm">
                            <span className="text-fg-subtle shrink-0">{k}</span>
                            <span className="text-fg text-right truncate">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  <div className="rounded-input border border-border p-4 space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-fg">Email verification</p>
                      <p className="text-xs text-fg-subtle mt-0.5">
                        We sent a 6-digit OTP to <span className="font-medium text-fg">{adminEmail}</span>. Enter it to unlock Launch.
                      </p>
                    </div>

                    {emailVerified ? (
                      <div className="flex items-center gap-2 text-sm text-success">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        Email verified — you can launch HRMS
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                        <Input
                          label="OTP code"
                          required
                          placeholder="6-digit code from email"
                          inputMode="numeric"
                          maxLength={6}
                          value={otp}
                          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          containerClass="flex-1"
                        />
                        <Button
                          type="button"
                          onClick={verifyOtp}
                          loading={otpVerifying}
                          disabled={otpVerifying || otp.length < 4}
                        >
                          Verify OTP
                        </Button>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        icon={Send}
                        loading={otpSending}
                        disabled={otpSending || resendLeft > 0 || emailVerified}
                        onClick={sendOtp}
                      >
                        {otpSending
                          ? 'Sending…'
                          : resendLeft > 0
                            ? `Resend in ${resendLeft}s`
                            : otpSent
                              ? 'Resend OTP'
                              : 'Send OTP'}
                      </Button>
                      {!emailVerified && otpSent && (
                        <span className="text-xs text-fg-subtle">Check spam if you don’t see the email.</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer nav */}
            <div className="px-6 pb-6 flex items-center justify-between pt-5 border-t border-border/60">
              <Button type="button" variant="ghost" icon={ArrowLeft} onClick={() => (step === 0 ? navigate('/welcome') : setStep((s) => s - 1))}>
                {step === 0 ? 'Back to welcome' : 'Back'}
              </Button>
              {step === 4 ? null : step < STEPS.length - 1 ? (
                <Button key="next" type="button" onClick={next} icon={ArrowRight} className="flex-row-reverse">Next</Button>
              ) : (
                <Button
                  key="submit"
                  type="button"
                  onClick={handleSubmit(onSubmit)}
                  icon={Rocket}
                  loading={launching}
                  disabled={launching || !emailVerified}
                >
                  Launch HRMS
                </Button>
              )}
            </div>
          </Card>
        </form>
      </div>
    </div>
  );
}
