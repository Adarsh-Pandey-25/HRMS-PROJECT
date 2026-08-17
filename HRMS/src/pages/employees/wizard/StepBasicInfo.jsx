import { useRef, useEffect, useState } from 'react';
import { Camera, Sparkles } from 'lucide-react';
import { Card, Input, Select, Button, Avatar } from '../../../components/ui';
import { DEPARTMENTS, EMPLOYMENT_TYPES } from '../../../lib/constants';
import { humanize } from '../../../lib/utils';
import toast from 'react-hot-toast';

const GENDERS = [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }];
const STATUSES = [
  { value: 'pending-setup', label: 'Pending Setup' },
  { value: 'probation', label: 'Probation' },
  { value: 'active', label: 'Active' },
];

export function PhotoUpload({ photoFile, onChange, name }) {
  const inputRef = useRef();
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    if (!photoFile) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(photoFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const onPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Photo must be an image file');
    if (file.size > 2 * 1024 * 1024) return toast.error('Photo must be under 2MB');
    onChange(file);
  };

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Avatar name={name} src={previewUrl} size="xl" />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-label="Upload employee photo"
          className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-primary text-white flex items-center justify-center shadow-card hover:bg-primary-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <Camera className="h-3.5 w-3.5" />
        </button>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
      </div>
      <div>
        <p className="text-sm font-medium text-fg">Employee photo</p>
        <p className="text-xs text-fg-subtle">JPG or PNG, up to 2MB</p>
      </div>
    </div>
  );
}

export function StepBasicInfo({ register, errors, watch, setValue, managerOptions, photoFile, setPhotoFile, shiftOptions, locationOptions }) {
  const fullName = watch('fullName');
  const maxDob = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const autoEmail = () => {
    if (fullName?.trim()) {
      const handle = fullName.trim().toLowerCase().replace(/\s+/g, '.');
      setValue('workEmail', `${handle}@spaxads.com`);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-fg mb-1">Basic Information</h2>
      <p className="text-xs text-fg-subtle mb-5">Only the required fields are needed to continue — everything else can be filled in later.</p>

      <div className="mb-6">
        <PhotoUpload photoFile={photoFile} onChange={setPhotoFile} name={fullName} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="Full name" required placeholder="e.g. Esther Howard" {...register('fullName')} error={errors.fullName?.message} />
        <Input label="Employee ID" required placeholder="Auto-generated — you can edit this" {...register('employeeId')} error={errors.employeeId?.message} />
        <Select label="Gender" placeholder="Select gender" options={GENDERS} {...register('gender')} />
        <Input label="Date of birth" type="date" max={maxDob} {...register('dob')} />
        <div className="flex items-start gap-2">
          <Input label="Work email" containerClass="flex-1 min-w-0" placeholder="e.g. esther.howard@company.com (auto-generated if left blank)" {...register('workEmail')} />
          <Button type="button" variant="outline" icon={Sparkles} onClick={autoEmail} className="shrink-0 mt-[1.375rem]">
            Generate
          </Button>
        </div>
        <Input label="Phone number" placeholder="e.g. +91-9876543210" {...register('phone')} />
        <Select label="Department" placeholder="Select department" options={DEPARTMENTS} {...register('department')} />
        <Input label="Post / Designation" required placeholder="e.g. Software Engineer, Accountant, Team Lead" {...register('designation')} error={errors.designation?.message} />
        <Select label="Reporting manager" placeholder="Search by name or ID" options={managerOptions} {...register('reportingTo')} />
        <Select label="Employment type" placeholder="Select type — Full-time / Part-time / Contract / Intern" options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: humanize(t) }))} {...register('employmentType')} />
        <Input label="Joining date" type="date" hint="Defaults to today" {...register('joinDate')} />
        <Select label="Shift" placeholder="Select shift" options={shiftOptions} {...register('shift')} />
        <Select label="Branch" placeholder="Select branch" options={locationOptions} {...register('workLocation')} />
        <Select label="Status" options={STATUSES} {...register('status')} />
        <Input label="CTC (Annual INR)" type="number" required placeholder="e.g. 600000" {...register('ctc')} error={errors.ctc?.message} />
      </div>
    </Card>
  );
}
