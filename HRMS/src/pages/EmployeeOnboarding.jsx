import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ImagePlus, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, Button, Input, Select } from '../components/ui';
import { PageLoader } from '../components/layout/PageLoader';
import {
  fetchEmployeeOnboardingApi,
  uploadEmployeeOnboardingPhotoApi,
  completeEmployeeOnboardingApi,
} from '../api/auth.api';
import { INDIAN_STATES } from '../lib/indianStates';

const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'An uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'A lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'A number', test: (p) => /[0-9]/.test(p) },
  { label: 'A special character', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

const EMPTY_FORM = {
  phone_number: '',
  date_of_birth: '',
  gender: '',
  address: { street: '', city: '', state: '', pincode: '' },
  emergency_contact: { name: '', phone: '' },
  bank_details: { bank_name: '', account_holder_name: '', account_number: '', ifsc_code: '' },
  password: '',
  confirm_password: '',
};

/**
 * Employee self-service profile completion, opened from the emailed link
 * https://{slug}.spaxsync.com/employee-onboarding?token=… (72h, one-time).
 * The token authorises only these /api/onboarding/* calls; the employee
 * signs in normally afterwards.
 */
export default function EmployeeOnboarding() {
  const navigate = useNavigate();
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') || '', []);
  const [status, setStatus] = useState('loading'); // loading | ready | invalid | done
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      setError('This link is missing its onboarding token. Use the link from your email.');
      return;
    }
    fetchEmployeeOnboardingApi(token)
      .then((data) => {
        setProfile(data);
        setPhotoUrl(data.profilePicture || null);
        setForm((f) => ({
          ...f,
          phone_number: data.phone || '',
          date_of_birth: data.dateOfBirth ? String(data.dateOfBirth).slice(0, 10) : '',
          gender: data.gender || '',
          address: { ...f.address, ...(data.address || {}) },
        }));
        setStatus('ready');
      })
      .catch((err) => {
        setStatus('invalid');
        setError(err.message || 'This onboarding link is invalid or has expired.');
      });
  }, [token]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setNested = (group, key, value) => setForm((f) => ({ ...f, [group]: { ...f[group], [key]: value } }));

  const passwordOk = PASSWORD_RULES.every((r) => r.test(form.password));

  const uploadPhoto = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const data = await uploadEmployeeOnboardingPhotoApi(token, file);
      setPhotoUrl(data.photoUrl);
      toast.success('Photo uploaded');
    } catch (err) {
      toast.error(err.message || 'Photo upload failed');
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!passwordOk) {
      toast.error('Choose a password that meets every rule');
      return;
    }
    if (form.password !== form.confirm_password) {
      toast.error('Passwords do not match');
      return;
    }
    setSaving(true);
    try {
      const { confirm_password: _confirmPassword, ...payload } = form;
      const hasBank = Object.values(payload.bank_details).some(Boolean);
      if (!hasBank) delete payload.bank_details;
      await completeEmployeeOnboardingApi(token, payload);
      setStatus('done');
    } catch (err) {
      toast.error(err.message || 'Could not save your details');
    } finally {
      setSaving(false);
    }
  };

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center bg-page"><PageLoader /></div>;
  }

  if (status === 'invalid' || status === 'done') {
    const done = status === 'done';
    return (
      <main className="min-h-screen flex items-center justify-center bg-page px-4">
        <Card className="p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-semibold text-fg">{done ? 'You’re all set' : 'Link not valid'}</h1>
          <p className="mt-2 text-sm text-fg-muted">
            {done ? 'Your profile is complete and your password is saved. Sign in with your work email and new password.' : error}
          </p>
          <Button className="mt-6 w-full" onClick={() => navigate('/', { replace: true })}>
            Go to sign in
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-page px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-8">
          <p className="text-sm font-medium text-primary">{profile?.companyName}</p>
          <h1 className="mt-1 text-page-title text-fg">Welcome, {profile?.firstName}. Complete your profile.</h1>
          <p className="mt-2 text-sm text-fg-muted">
            A few details for HR and payroll, then set your own password. You can upload ID documents such as Aadhaar and PAN from the Documents section after you sign in.
          </p>
        </header>

        <form onSubmit={submit} className="space-y-6">
          <Card className="p-6 space-y-4">
            <h2 className="text-base font-semibold text-fg">Personal details</h2>
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-muted overflow-hidden flex items-center justify-center">
                {photoUrl ? <img src={photoUrl} alt="Your profile" className="h-full w-full object-cover" /> : <UserRound className="h-7 w-7 text-fg-subtle" />}
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-input border border-border px-3 py-2 text-sm text-fg-muted hover:border-primary hover:text-primary">
                <ImagePlus className="h-4 w-4" />
                {uploading ? 'Uploading…' : 'Upload photo (optional)'}
                <input type="file" accept=".png,.jpg,.jpeg" className="sr-only" disabled={uploading} onChange={(e) => uploadPhoto(e.target.files?.[0])} />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" value={form.phone_number} onChange={(e) => set('phone_number', e.target.value)} />
              <Input label="Date of birth" type="date" value={form.date_of_birth} onChange={(e) => set('date_of_birth', e.target.value)} />
              <Select label="Gender" placeholder="Select" options={GENDER_OPTIONS} value={form.gender} onChange={(e) => set('gender', e.target.value)} />
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="text-base font-semibold text-fg">Address</h2>
            <Input label="Street address" autoComplete="street-address" value={form.address.street} onChange={(e) => setNested('address', 'street', e.target.value)} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="City" autoComplete="address-level2" value={form.address.city} onChange={(e) => setNested('address', 'city', e.target.value)} />
              <Select label="State" placeholder="Select" options={INDIAN_STATES.map((s) => s.name)} value={form.address.state} onChange={(e) => setNested('address', 'state', e.target.value)} />
              <Input label="Pincode" inputMode="numeric" maxLength={6} autoComplete="postal-code" value={form.address.pincode} onChange={(e) => setNested('address', 'pincode', e.target.value.replace(/\D/g, ''))} />
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="text-base font-semibold text-fg">Emergency contact</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Name" value={form.emergency_contact.name} onChange={(e) => setNested('emergency_contact', 'name', e.target.value)} />
              <Input label="Phone" type="tel" inputMode="tel" value={form.emergency_contact.phone} onChange={(e) => setNested('emergency_contact', 'phone', e.target.value)} />
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-fg">Bank details <span className="text-sm font-normal text-fg-subtle">(optional)</span></h2>
              <p className="mt-1 text-sm text-fg-muted">Used for salary payments. You can also add these later with HR.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Bank name" value={form.bank_details.bank_name} onChange={(e) => setNested('bank_details', 'bank_name', e.target.value)} />
              <Input label="Account holder name" value={form.bank_details.account_holder_name} onChange={(e) => setNested('bank_details', 'account_holder_name', e.target.value)} />
              <Input label="Account number" inputMode="numeric" value={form.bank_details.account_number} onChange={(e) => setNested('bank_details', 'account_number', e.target.value.replace(/\D/g, ''))} />
              <Input label="IFSC code" value={form.bank_details.ifsc_code} onChange={(e) => setNested('bank_details', 'ifsc_code', e.target.value.toUpperCase())} />
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="text-base font-semibold text-fg">Set your password</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="New password" type="password" required autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} />
              <Input label="Confirm password" type="password" required autoComplete="new-password" value={form.confirm_password} onChange={(e) => set('confirm_password', e.target.value)} />
            </div>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {PASSWORD_RULES.map((rule) => {
                const ok = rule.test(form.password);
                return (
                  <li key={rule.label} className={`flex items-center gap-2 text-xs ${ok ? 'text-primary' : 'text-fg-subtle'}`}>
                    <Check className={`h-3.5 w-3.5 ${ok ? 'opacity-100' : 'opacity-30'}`} />
                    {rule.label}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Button type="submit" size="lg" className="w-full" loading={saving} disabled={saving}>
            Complete my profile
          </Button>
        </form>
      </div>
    </main>
  );
}
