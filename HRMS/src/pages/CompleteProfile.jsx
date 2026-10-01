import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { ArrowRight, Banknote, HeartPulse, LogOut, MapPin, ShieldCheck, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, Input, Select } from '../components/ui';
import { AddressFields, EmergencyContactFields } from '../components/shared/ContactDetailFields';
import { ForcePasswordChangeModal } from '../components/auth/ForcePasswordChangeModal';
import { completeProfileApi } from '../api/auth.api';
import { useAuthStore } from '../store/authStore';
import { useCompanyStore } from '../store/companyStore';

/**
 * First sign-in for someone HR/Admin added without their personal details.
 * RequireAuth sends them here and keeps them here until this is saved.
 * The rules match the server (profileCompletion.service.js) and HR's Edit
 * Employee form, so what is accepted here never trips either of them later.
 */

const NAME_RE = /^[A-Za-z][A-Za-z\s.'-]*$/;
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const letters = (label) => z.string().trim().min(1, 'Required').regex(NAME_RE, `${label} must contain letters only`);
const tenDigits = (label) => z.string().trim().regex(/^\d{10}$/, `${label} must be exactly 10 digits`);

const schema = z.object({
  dob: z.string().min(1, 'Required')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date')
    .refine((v) => v <= todayISO(), 'Date of birth cannot be a future date')
    .refine((v) => v >= '1900-01-01', 'Enter a valid date'),
  gender: z.string().min(1, 'Required'),
  personalEmail: z.string().trim().min(1, 'Required').email('Enter a valid email (e.g. name@gmail.com)'),
  phone: tenDigits('Phone number'),

  addressLine1: z.string().trim().min(1, 'Required'),
  addressLine2: z.string().trim().min(1, 'Required'),
  city: letters('City'),
  state: letters('State'),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Pincode must be exactly 6 digits'),
  country: letters('Country'),

  emergencyName: letters('Name'),
  emergencyPhone: tenDigits('Phone number'),
  emergencyRelation: letters('Relation'),

  bankName: z.string().trim().min(1, 'Required').regex(/^[A-Za-z][A-Za-z\s.'&-]*$/, 'Bank name must contain letters only'),
  bankAccount: z.string().trim().regex(/^\d{9,18}$/, 'Account number must be 9–18 digits'),
  bankIfsc: z.string().trim().regex(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, 'Enter a valid IFSC (e.g. HDFC0001234)'),
});

const SECTIONS = [
  { icon: UserRound, title: 'About you', fields: ['dob', 'gender', 'personalEmail', 'phone'] },
  { icon: MapPin, title: 'Address', fields: ['addressLine1', 'addressLine2', 'city', 'state', 'pincode', 'country'] },
  { icon: HeartPulse, title: 'Emergency contact', fields: ['emergencyName', 'emergencyPhone', 'emergencyRelation'] },
  { icon: Banknote, title: 'Bank details', fields: ['bankName', 'bankAccount', 'bankIfsc'] },
];

/** Whatever HR (or the invite link, which used older field names) already filled in. */
function defaultsFrom(user = {}) {
  const addr = user.addressRaw || {};
  const ec = user.emergencyContact || {};
  const bank = user.bank || {};
  const rawBank = user.bankDetails || {};
  return {
    dob: (user.dob || '').slice(0, 10),
    gender: user.gender || '',
    personalEmail: addr.personalEmail || addr.personal_email || '',
    phone: String(user.phone || '').replace(/\D/g, '').slice(-10),
    addressLine1: addr.line1 || addr.street || '',
    addressLine2: addr.line2 || '',
    city: addr.city || '',
    state: addr.state || '',
    pincode: addr.pincode || '',
    country: addr.country || 'India',
    emergencyName: ec.name || '',
    emergencyPhone: String(ec.phone || '').replace(/\D/g, '').slice(-10),
    emergencyRelation: ec.relation || '',
    bankName: bank.name || '',
    bankAccount: bank.account || '',
    bankIfsc: (bank.ifsc || rawBank.ifscCode || '').toUpperCase(),
  };
}

const onlyLetters = (e) => { e.target.value = e.target.value.replace(/[^A-Za-z\s.'-]/g, ''); };
const onlyDigits = (max) => (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, max); };

function Section({ icon: Icon, title, subtitle, done, children }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${done ? 'bg-success/12 text-success' : 'bg-primary/10 text-primary'}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-fg-subtle">{subtitle}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

export default function CompleteProfile() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const setProfileCompleted = useAuthStore((s) => s.setProfileCompleted);
  const company = useCompanyStore((s) => s.company);
  const [saving, setSaving] = useState(false);

  const {
    register, handleSubmit, watch, formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues: defaultsFrom(user), mode: 'onTouched' });

  const values = watch();
  const filled = (f) => String(values[f] ?? '').trim() !== '';
  const sectionDone = (s) => s.fields.every(filled) && s.fields.every((f) => !errors[f]);
  const doneCount = SECTIONS.filter(sectionDone).length;

  const onSubmit = async (d) => {
    setSaving(true);
    try {
      const updated = await completeProfileApi({
        date_of_birth: d.dob,
        gender: d.gender,
        phone: d.phone,
        personal_email: d.personalEmail,
        address: {
          line1: d.addressLine1, line2: d.addressLine2, city: d.city, state: d.state, pincode: d.pincode, country: d.country,
        },
        emergency_contact: { name: d.emergencyName, phone: d.emergencyPhone, relation: d.emergencyRelation },
        bank_details: { bank_name: d.bankName, account_number: d.bankAccount, ifsc: d.bankIfsc.toUpperCase() },
      });
      setProfileCompleted(updated);
      toast.success('Thanks — your profile is complete.');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast.error(err.message || 'Could not save your details');
    } finally {
      setSaving(false);
    }
  };

  const companyName = company?.name || user?.companyName || '';

  return (
    <div className="min-h-screen bg-page">
      <header className="sticky top-0 z-20 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            {company?.logoUrl
              ? <img src={company.logoUrl} alt="" className="h-8 w-8 rounded-lg bg-white object-contain p-0.5 ring-1 ring-border" />
              : (
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-on-primary">
                  {(companyName[0] || 'S').toUpperCase()}
                </span>
              )}
            <span className="truncate text-sm font-semibold text-fg">{companyName}</span>
          </div>
          <Button variant="ghost" size="sm" icon={LogOut} onClick={() => logout()}>Sign out</Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-8">
        <div className="mb-8">
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
            <ShieldCheck className="h-3.5 w-3.5" /> One-time setup
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">
            Welcome{user?.firstName ? `, ${user.firstName}` : ''}! Let&apos;s complete your profile.
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-fg-muted">
            HR needs these details for your records and payroll. It takes about two minutes, and you only do it once —
            your dashboard opens as soon as you save.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${(doneCount / SECTIONS.length) * 100}%` }} />
            </div>
            <span className="text-xs font-medium tabular-nums text-fg-muted">{doneCount} of {SECTIONS.length} sections</span>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <Section icon={UserRound} title="About you" done={sectionDone(SECTIONS[0])}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Date of birth" type="date" required max={todayISO()} {...register('dob')} error={errors.dob?.message} />
              <Select
                label="Gender"
                required
                placeholder="Select gender"
                options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }]}
                {...register('gender')}
                error={errors.gender?.message}
              />
              <Input label="Personal email" type="email" required autoComplete="email" placeholder="e.g. name@gmail.com" {...register('personalEmail')} error={errors.personalEmail?.message} />
              <Input label="Mobile number" required inputMode="numeric" autoComplete="tel-national" maxLength={10} placeholder="e.g. 9876543210" {...register('phone')} onInput={onlyDigits(10)} error={errors.phone?.message} />
            </div>
          </Section>

          <Section icon={MapPin} title="Address" subtitle="Where you currently live." done={sectionDone(SECTIONS[1])}>
            <AddressFields register={register} errors={errors} onPincodeInput={onlyDigits(6)} onLettersInput={onlyLetters} />
          </Section>

          <Section icon={HeartPulse} title="Emergency contact" done={sectionDone(SECTIONS[2])}>
            {/* The shared component brings its own heading; this card already has one. */}
            <div className="[&>div>div:first-child]:hidden">
              <EmergencyContactFields register={register} errors={errors} onPhoneInput={onlyDigits(10)} onNameInput={onlyLetters} />
            </div>
          </Section>

          <Section icon={Banknote} title="Bank details" subtitle="Your salary is paid into this account." done={sectionDone(SECTIONS[3])}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Bank name"
                required
                placeholder="e.g. HDFC Bank"
                {...register('bankName')}
                onInput={(e) => { e.target.value = e.target.value.replace(/[^A-Za-z\s.'&-]/g, ''); }}
                error={errors.bankName?.message}
              />
              <Input label="Account number" required inputMode="numeric" placeholder="e.g. 50100123456789" {...register('bankAccount')} onInput={onlyDigits(18)} error={errors.bankAccount?.message} />
              <Input
                label="IFSC code"
                required
                placeholder="e.g. HDFC0001234"
                containerClass="sm:col-span-2"
                maxLength={11}
                {...register('bankIfsc')}
                onInput={(e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11); }}
                error={errors.bankIfsc?.message}
              />
            </div>
          </Section>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-fg-subtle">
              After this, changes go through your profile&apos;s one-time edit or HR.
            </p>
            <Button type="submit" size="lg" loading={saving} disabled={saving}>
              Save and continue
              {!saving && <ArrowRight className="h-4 w-4" />}
            </Button>
          </div>
        </form>
      </main>

      {/* Outside the app layout, so the temporary-password step lives here too. */}
      <ForcePasswordChangeModal />
    </div>
  );
}
