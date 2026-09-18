/**
 * Map a Settings document type name (e.g. "Aadhaar Card") to the backend's
 * fixed document_type enum. Shared between the Add Employee wizard and the
 * employee self-service "Edit my info" document uploads so both stay in sync.
 */
export function mapWizardDocType(name = '') {
  const n = String(name).toLowerCase();
  if (n.includes('aadhaar') || n.includes('aadhar')) return 'aadhar';
  if (n.includes('pan')) return 'pan';
  if (n.includes('offer')) return 'offer_letter';
  if (n.includes('join')) return 'joining_letter';
  if (n.includes('reliev')) return 'relieving_letter';
  if (n.includes('experience')) return 'experience_letter';
  if (n.includes('resign')) return 'resignation_letter';
  if (n.includes('form 16') || n.includes('form16')) return 'form_16';
  if (n.includes('payslip')) return 'payslip';
  return 'educational_certificate';
}
