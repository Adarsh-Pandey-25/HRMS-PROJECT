import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Ban, CheckCircle2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Badge, Input, Select, Modal } from '../../components/ui';
import { useSettingsStore } from '../../store/settingsStore';
import { updateSettingApi } from '../../api/settings.api';
import { humanize } from '../../lib/utils';
import { invalidateAndRefetch } from '../../lib/queryCache';

const CATEGORIES = ['identity', 'education', 'employment', 'custom'];
const FORMATS = ['pdf', 'jpg', 'png'];
const SIZE_OPTIONS = [2, 5, 10];
const EMPTY_DOC = { name: '', category: 'custom', isRequired: false, acceptedFormats: ['pdf', 'jpg', 'png'], maxSizeMB: 5 };

const CATEGORY_TONE = { identity: 'primary', education: 'teal', employment: 'info', custom: 'warning' };

/**
 * Persist the current in-memory document types to the server. Every action
 * below mutates the local zustand store first (synchronously) then calls
 * this with the fresh state, so each Add/Edit/Toggle/Delete is saved
 * immediately instead of relying on a separate "Save to server" step.
 */
async function persistDocumentTypes(qc) {
  const next = useSettingsStore.getState().documentTypes;
  await updateSettingApi('document_types', next);
  await invalidateAndRefetch(qc, ['settings']);
}

function DocTypeModal({ open, onClose, editing }) {
  const qc = useQueryClient();
  const addDocumentType = useSettingsStore((s) => s.addDocumentType);
  const updateDocumentType = useSettingsStore((s) => s.updateDocumentType);
  const removeDocumentType = useSettingsStore((s) => s.removeDocumentType);
  const [form, setForm] = useState(EMPTY_DOC);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? { ...editing, acceptedFormats: [...(editing.acceptedFormats || [])] }
        : { ...EMPTY_DOC, acceptedFormats: [...EMPTY_DOC.acceptedFormats] }
    );
  }, [open, editing]);

  const toggleFormat = (f) =>
    setForm((s) => ({
      ...s,
      acceptedFormats: s.acceptedFormats.includes(f) ? s.acceptedFormats.filter((x) => x !== f) : [...s.acceptedFormats, f],
    }));

  const save = async () => {
    if (!form.name.trim()) return toast.error('Document name is required');
    if (form.acceptedFormats.length === 0) return toast.error('Select at least one accepted format');

    setSaving(true);
    try {
      if (editing) {
        updateDocumentType(editing.id, form);
        await persistDocumentTypes(qc);
        toast.success('Document type updated');
      } else {
        addDocumentType(form);
        await persistDocumentTypes(qc);
        toast.success('Document type added');
      }
      onClose();
    } catch (err) {
      // Roll back the optimistic local change so the UI doesn't claim a
      // save that never reached the server.
      if (editing) {
        updateDocumentType(editing.id, editing);
      } else {
        const added = useSettingsStore.getState().documentTypes.slice(-1)[0];
        if (added) removeDocumentType(added.id);
      }
      toast.error(err.message || 'Failed to save document type');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Document Type' : 'Add Document Type'} footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save' : 'Add Document Type')}</Button></>}>
      <div className="space-y-4">
        <Input label="Document name" required placeholder='e.g. "Police Verification"' value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Select label="Category" options={CATEGORIES.map((c) => ({ value: c, label: humanize(c) }))} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <div className="flex items-center justify-between rounded-input border border-border p-3">
          <div>
            <p className="text-sm font-medium text-fg">Required?</p>
            <p className="text-xs text-fg-subtle">Mandatory for all future employees</p>
          </div>
          <input type="checkbox" className="h-5 w-5 accent-primary" checked={form.isRequired} onChange={(e) => setForm({ ...form, isRequired: e.target.checked })} />
        </div>
        <div>
          <p className="text-xs font-medium text-fg-muted mb-2">Accepted formats</p>
          <div className="flex gap-4">
            {FORMATS.map((f) => (
              <label key={f} className="flex items-center gap-1.5 text-sm text-fg cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.acceptedFormats.includes(f)} onChange={() => toggleFormat(f)} />
                {f.toUpperCase()}
              </label>
            ))}
          </div>
        </div>
        <Select label="Max size" options={SIZE_OPTIONS.map((s) => ({ value: s, label: `${s}MB` }))} value={form.maxSizeMB} onChange={(e) => setForm({ ...form, maxSizeMB: Number(e.target.value) })} />
      </div>
    </Modal>
  );
}

export function DocumentConfigSection() {
  const qc = useQueryClient();
  const documentTypes = useSettingsStore((s) => s.documentTypes);
  const toggleActive = useSettingsStore((s) => s.toggleDocumentTypeActive);
  const removeDocumentType = useSettingsStore((s) => s.removeDocumentType);
  const setDocumentTypes = useSettingsStore((s) => s.setDocumentTypes);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const openAdd = () => { setEditing(null); setModal(true); };
  const openEdit = (d) => { setEditing(d); setModal(true); };

  const handleToggleActive = async (d) => {
    setBusyId(d.id);
    const prev = documentTypes;
    toggleActive(d.id);
    try {
      await persistDocumentTypes(qc);
      toast.success(d.isActive ? 'Document type disabled' : 'Document type enabled');
    } catch (err) {
      setDocumentTypes(prev);
      toast.error(err.message || 'Failed to update document type');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (d) => {
    setBusyId(d.id);
    const prev = documentTypes;
    removeDocumentType(d.id);
    try {
      await persistDocumentTypes(qc);
      toast.success('Document type removed');
    } catch (err) {
      setDocumentTypes(prev);
      toast.error(err.message || 'Failed to remove document type');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Employee Document Config"
        subtitle="Manage which document types appear in the Add Employee form"
        action={<Button size="sm" icon={Plus} onClick={openAdd}>Add Document Type</Button>}
      />
      <div className="p-5 pt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {['Document Name', 'Category', 'Required?', 'Accepted Formats', 'Active', 'Actions'].map((h) => (
                <th key={h} className="py-2.5 font-semibold text-fg-subtle text-xs uppercase tracking-wide px-2 first:pl-0">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {documentTypes.map((d) => (
              <tr key={d.id} className="border-b border-border/50">
                <td className="py-2.5 px-2 pl-0 text-fg font-medium">{d.name}</td>
                <td className="py-2.5 px-2"><Badge tone={CATEGORY_TONE[d.category] || 'neutral'}>{humanize(d.category)}</Badge></td>
                <td className="py-2.5 px-2 text-fg-muted">{d.isRequired ? 'Yes' : 'No'}</td>
                <td className="py-2.5 px-2 text-fg-muted uppercase text-xs">{d.acceptedFormats.join(', ')}</td>
                <td className="py-2.5 px-2">
                  {d.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Disabled</Badge>}
                </td>
                <td className="py-2.5 px-2">
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(d)} disabled={busyId === d.id} className="p-1.5 rounded-md text-fg-subtle hover:bg-muted hover:text-fg disabled:opacity-50" title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleToggleActive(d)} disabled={busyId === d.id} className="p-1.5 rounded-md text-fg-subtle hover:bg-muted hover:text-fg disabled:opacity-50" title={d.isActive ? 'Disable' : 'Enable'}>
                      {d.isActive ? <Ban className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    </button>
                    {!d.isDefault && (
                      <button onClick={() => handleRemove(d)} disabled={busyId === d.id} className="p-1.5 rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger disabled:opacity-50" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocTypeModal open={modal} onClose={() => setModal(false)} editing={editing} />
    </Card>
  );
}
