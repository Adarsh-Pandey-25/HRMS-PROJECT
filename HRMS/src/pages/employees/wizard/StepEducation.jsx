import { useState } from 'react';
import { GraduationCap, Plus, Pencil, Trash2 } from 'lucide-react';
import { Card, Button, Input, Modal, EmptyState } from '../../../components/ui';
import { DocUploadCard } from './DocUploadCard';
import toast from 'react-hot-toast';

const CERT_DOC_TYPE = { id: 'certificate', name: 'Certificate', isRequired: false, acceptedFormats: ['pdf', 'jpg', 'png'], maxSizeMB: 5 };
const MARKSHEET_DOC_TYPE = { id: 'marksheet', name: 'Mark sheet', isRequired: false, acceptedFormats: ['pdf', 'jpg', 'png'], maxSizeMB: 5 };

const EMPTY_RECORD = { qualification: '', degree: '', institute: '', university: '', passingYear: '', percentage: '', certificateFile: null, marksheetFile: null };

function EducationRecordModal({ open, initial, onClose, onSave }) {
  const [form, setForm] = useState(initial || EMPTY_RECORD);

  const set = (patch) => setForm((s) => ({ ...s, ...patch }));

  const save = () => {
    if (!form.qualification.trim() || !form.institute.trim()) {
      toast.error('Qualification and institute are required');
      return;
    }
    onSave(form);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit education record' : 'Add education record'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save record</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="Qualification" required placeholder="e.g. B.Tech, MBA, 12th Standard" value={form.qualification} onChange={(e) => set({ qualification: e.target.value })} />
        <Input label="Degree" placeholder="e.g. Computer Science" value={form.degree} onChange={(e) => set({ degree: e.target.value })} />
        <Input label="Institute name" required placeholder="e.g. IIT Bombay" value={form.institute} onChange={(e) => set({ institute: e.target.value })} />
        <Input label="University" placeholder="e.g. Mumbai University" value={form.university} onChange={(e) => set({ university: e.target.value })} />
        <Input label="Passing year" type="number" placeholder="e.g. 2019" value={form.passingYear} onChange={(e) => set({ passingYear: e.target.value })} />
        <Input label="Percentage / CGPA" placeholder="e.g. 8.4 CGPA or 82%" value={form.percentage} onChange={(e) => set({ percentage: e.target.value })} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        <DocUploadCard docType={CERT_DOC_TYPE} value={form.certificateFile} onChange={(f) => set({ certificateFile: f })} />
        <DocUploadCard docType={MARKSHEET_DOC_TYPE} value={form.marksheetFile} onChange={(f) => set({ marksheetFile: f })} />
      </div>
    </Modal>
  );
}

/** Step 3 — a dynamic, add/edit/delete list of education records. */
export function StepEducation({ records, setRecords, embedded = false }) {
  const [modalState, setModalState] = useState(null); // null | { id: null|string, record }

  const addRecord = (record) => {
    setRecords((prev) => [...prev, { ...record, id: `EDU-${Date.now()}` }]);
    toast.success('Education record added');
    setModalState(null);
  };

  const updateRecord = (record) => {
    setRecords((prev) => prev.map((r) => (r.id === modalState.id ? { ...record, id: r.id } : r)));
    toast.success('Education record updated');
    setModalState(null);
  };

  const deleteRecord = (id) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    toast.success('Education record removed');
  };

  return (
    <Card className={embedded ? 'p-0 border-0 shadow-none bg-transparent' : 'p-6'}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-semibold text-fg mb-1">Education Documents</h2>
          <p className="text-xs text-fg-subtle">Add one or more qualifications — this step can be skipped entirely.</p>
        </div>
        <Button type="button" size="sm" icon={Plus} onClick={() => setModalState({ id: null, record: null })}>Add Education</Button>
      </div>

      {records.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No education records yet" message='Click "Add Education" to add a qualification.' />
      ) : (
        <div className="space-y-3">
          {records.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-3 rounded-input border border-border p-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">{r.qualification}{r.degree && ` · ${r.degree}`}</p>
                <p className="text-xs text-fg-subtle mt-0.5">{r.institute}{r.university && `, ${r.university}`}</p>
                <p className="text-xs text-fg-subtle">{[r.passingYear, r.percentage].filter(Boolean).join(' · ')}</p>
                <div className="flex gap-3 mt-1.5">
                  {r.certificateFile && <span className="text-[11px] text-primary">📄 {r.certificateFile.name}</span>}
                  {r.marksheetFile && <span className="text-[11px] text-primary">📄 {r.marksheetFile.name}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => setModalState({ id: r.id, record: r })} aria-label={`Edit ${r.qualification}`} className="text-fg-subtle hover:text-primary p-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => deleteRecord(r.id)} aria-label={`Delete ${r.qualification}`} className="text-fg-subtle hover:text-danger p-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalState && (
        <EducationRecordModal
          open
          initial={modalState.record}
          onClose={() => setModalState(null)}
          onSave={modalState.id ? updateRecord : addRecord}
        />
      )}
    </Card>
  );
}
