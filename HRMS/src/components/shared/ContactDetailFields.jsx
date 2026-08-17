import { Input } from '../ui';

/** Shared address + emergency contact fields — used by company onboarding and employee Personal. */
export function AddressFields({
  register,
  errors = {},
  required = true,
  onPincodeInput,
  onLettersInput,
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Input
        label="Address line 1"
        required={required}
        placeholder="e.g. 4th Floor, Nexus Tower"
        containerClass="sm:col-span-2"
        {...register('addressLine1')}
        error={errors.addressLine1?.message}
      />
      <Input
        label="Address line 2"
        required={required}
        placeholder="e.g. Koramangala 5th Block"
        containerClass="sm:col-span-2"
        {...register('addressLine2')}
        error={errors.addressLine2?.message}
      />
      <Input
        label="City"
        required={required}
        placeholder="e.g. Bengaluru"
        {...register('city')}
        onInput={onLettersInput}
        error={errors.city?.message}
      />
      <Input
        label="State"
        required={required}
        placeholder="e.g. Karnataka"
        {...register('state')}
        onInput={onLettersInput}
        error={errors.state?.message}
      />
      <Input
        label="Pincode"
        required={required}
        placeholder="e.g. 560095"
        inputMode="numeric"
        maxLength={6}
        {...register('pincode')}
        onInput={onPincodeInput}
        error={errors.pincode?.message}
      />
      <Input
        label="Country"
        required={required}
        placeholder="e.g. India"
        {...register('country')}
        onInput={onLettersInput}
        error={errors.country?.message}
      />
    </div>
  );
}

export function EmergencyContactFields({
  register,
  errors = {},
  required = true,
  onPhoneInput,
  onNameInput,
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-fg">Emergency Contact</h3>
        <p className="text-xs text-fg-subtle mt-0.5">Person to reach in case of emergency.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Emergency contact name"
          required={required}
          placeholder="e.g. Jane Doe"
          {...register('emergencyName')}
          onInput={onNameInput}
          error={errors.emergencyName?.message}
        />
        <Input
          label="Emergency contact phone"
          required={required}
          placeholder="e.g. 9876543210"
          inputMode="numeric"
          maxLength={10}
          {...register('emergencyPhone')}
          onInput={onPhoneInput}
          error={errors.emergencyPhone?.message}
        />
        <Input
          label="Relation"
          required={required}
          placeholder="e.g. Spouse, Parent, Sibling"
          containerClass="sm:col-span-2"
          {...register('emergencyRelation')}
          onInput={onNameInput}
          error={errors.emergencyRelation?.message}
        />
      </div>
    </div>
  );
}
