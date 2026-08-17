import { Card } from '../../../components/ui';
import { DocUploadCard } from './DocUploadCard';

/**
 * Step 2 — Identity documents (Aadhaar, PAN, Passport, etc.). The Employee
 * Photo document type is intentionally excluded here since Step 1 already
 * captures a dedicated profile photo.
 */
export function StepDocuments({ documentTypes, files, setFile, embedded = false }) {
  const identity = documentTypes.filter((d) => d.category === 'identity' && d.name !== 'Employee Photo');

  const body = (
    <>
      <h2 className="text-base font-semibold text-fg mb-1">Documents</h2>
      <p className="text-xs text-fg-subtle mb-4">Identity proofs — these can also be uploaded later from the employee&apos;s Documents tab.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {identity.map((d) => (
          <DocUploadCard key={d.id} docType={d} value={files[d.id] || null} onChange={(file) => setFile(d.id, file)} />
        ))}
      </div>
    </>
  );

  if (embedded) return <div>{body}</div>;
  return <Card className="p-6">{body}</Card>;
}
