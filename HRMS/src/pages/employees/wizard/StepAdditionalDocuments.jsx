import { useState } from 'react';
import { Plus, FolderPlus } from 'lucide-react';
import { Card, Button, Input, EmptyState } from '../../../components/ui';
import { useAuthStore } from '../../../store/authStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { DocUploadCard } from './DocUploadCard';
import { cn } from '../../../lib/utils';
import toast from 'react-hot-toast';

/**
 * Step 4 — additional supporting documents (Bank, Medical, Police
 * Verification, Certifications, etc). These map to the "custom" document
 * type category, which Admin/HR can extend inline with new types.
 */
export function StepAdditionalDocuments({ documentTypes, files, setFile, embedded = false }) {
  const canManageDocTypes = useAuthStore((s) => s.can(['admin', 'hr']));
  const addDocumentType = useSettingsStore((s) => s.addDocumentType);
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [newType, setNewType] = useState({ name: '', isRequired: false, acceptedFormats: ['pdf', 'jpg', 'png'] });

  const custom = documentTypes.filter((d) => d.category === 'custom');

  const toggleFormat = (f) =>
    setNewType((s) => ({ ...s, acceptedFormats: s.acceptedFormats.includes(f) ? s.acceptedFormats.filter((x) => x !== f) : [...s.acceptedFormats, f] }));

  const addType = () => {
    if (!newType.name.trim()) return toast.error('Document name is required');
    addDocumentType({ ...newType, category: 'custom', maxSizeMB: 5 });
    toast.success('Document type added');
    setNewType({ name: '', isRequired: false, acceptedFormats: ['pdf', 'jpg', 'png'] });
    setAddTypeOpen(false);
  };

  return (
    <Card className={embedded ? 'p-0 border-0 shadow-none bg-transparent' : 'p-6'}>
      <h2 className="text-base font-semibold text-fg mb-1">Additional Documents</h2>
      <p className="text-xs text-fg-subtle mb-4">Bank details, medical records, verifications, certifications and any other supporting documents.</p>

      {custom.length === 0 && !canManageDocTypes && (
        <EmptyState icon={FolderPlus} title="No additional document types configured" message="Ask an Admin or HR user to add document types from Settings." />
      )}

      {custom.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {custom.map((d) => (
            <DocUploadCard key={d.id} docType={d} value={files[d.id] || null} onChange={(file) => setFile(d.id, file)} />
          ))}
        </div>
      )}

      {canManageDocTypes && (
        addTypeOpen ? (
          <div className={cn('rounded-input border border-border p-4 space-y-3', custom.length > 0 && 'mt-3')}>
            <Input label="Document name" placeholder='e.g. "Bank Documents", "Police Verification"' value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} />
            <label className="flex items-center gap-2 text-sm text-fg cursor-pointer">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={newType.isRequired} onChange={(e) => setNewType({ ...newType, isRequired: e.target.checked })} />
              Required for future employees
            </label>
            <div className="flex gap-4">
              {['pdf', 'jpg', 'png'].map((f) => (
                <label key={f} className="flex items-center gap-1.5 text-sm text-fg cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={newType.acceptedFormats.includes(f)} onChange={() => toggleFormat(f)} />
                  {f.toUpperCase()}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setAddTypeOpen(false)}>Cancel</Button>
              <Button type="button" size="sm" onClick={addType}>Add</Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setAddTypeOpen(true)} className={cn('text-xs font-medium text-primary hover:underline flex items-center gap-1', custom.length > 0 && 'mt-3')}>
            <Plus className="h-3.5 w-3.5" /> Add Document Type
          </button>
        )
      )}
    </Card>
  );
}
