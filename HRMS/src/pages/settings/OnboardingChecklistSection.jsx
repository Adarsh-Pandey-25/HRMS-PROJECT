import { useEffect, useState } from 'react';
import { Plus, Pencil, Ban, CheckCircle2, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Badge, Input, Modal, EmptyState, Skeleton } from '../../components/ui';
import { useChecklistTemplates, useChecklistTemplateMutations } from '../../hooks/useModules';

/**
 * Admin-configurable Onboarding Checklist templates — same shape as Employee
 * Document Config: HR/Admin can add, rename, reorder, disable, or delete
 * items, and it applies to every candidate's checklist company-wide
 * (Recruitment > Offers). Every action below calls its endpoint immediately
 * (no separate "Save to server" step).
 */

function TemplateModal({ open, onClose, editing, onSave, saving }) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!open) return;
    setLabel(editing ? editing.label : '');
  }, [open, editing]);

  const save = async () => {
    if (!label.trim()) return toast.error('Checklist item name is required');
    await onSave(label.trim());
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit Checklist Item' : 'Add Checklist Item'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save' : 'Add Item')}</Button>
        </>
      }
    >
      <Input
        label="Checklist item"
        required
        autoFocus
        placeholder='e.g. "Collect signed NDA"'
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
    </Modal>
  );
}

export function OnboardingChecklistSection() {
  const { data: templates = [], isLoading } = useChecklistTemplates();
  const { createTemplate, updateTemplate, deleteTemplate } = useChecklistTemplateMutations();
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const sorted = [...templates].sort((a, b) => a.sortOrder - b.sortOrder);

  const openAdd = () => { setEditing(null); setModal(true); };
  const openEdit = (t) => { setEditing(t); setModal(true); };

  const handleSave = async (label) => {
    try {
      if (editing) {
        await updateTemplate.mutateAsync({ id: editing.id, patch: { label } });
        toast.success('Checklist item updated');
      } else {
        await createTemplate.mutateAsync({ label });
        toast.success('Checklist item added');
      }
      setModal(false);
    } catch (err) {
      toast.error(err.message || 'Failed to save checklist item');
    }
  };

  const handleToggleActive = async (t) => {
    setBusyId(t.id);
    try {
      await updateTemplate.mutateAsync({ id: t.id, patch: { isActive: !t.isActive } });
      toast.success(t.isActive ? 'Checklist item disabled' : 'Checklist item enabled');
    } catch (err) {
      toast.error(err.message || 'Failed to update checklist item');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (t) => {
    setBusyId(t.id);
    try {
      await deleteTemplate.mutateAsync(t.id);
      toast.success('Checklist item removed');
    } catch (err) {
      toast.error(err.message || 'Failed to remove checklist item');
    } finally {
      setBusyId(null);
    }
  };

  const handleMove = async (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sorted.length) return;
    const current = sorted[index];
    const target = sorted[targetIndex];
    setBusyId(current.id);
    try {
      await Promise.all([
        updateTemplate.mutateAsync({ id: current.id, patch: { sortOrder: target.sortOrder } }),
        updateTemplate.mutateAsync({ id: target.id, patch: { sortOrder: current.sortOrder } }),
      ]);
    } catch (err) {
      toast.error(err.message || 'Failed to reorder checklist items');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Onboarding Checklist"
        subtitle="Manage the checklist items shown for every accepted candidate in Recruitment > Offers"
        action={<Button size="sm" icon={Plus} onClick={openAdd}>Add Checklist Item</Button>}
      />
      <div className="p-5 pt-3">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState title="No checklist items" message="Add the first onboarding checklist item for your company." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['Order', 'Checklist Item', 'Active', 'Actions'].map((h) => (
                    <th key={h} className="py-2.5 font-semibold text-fg-subtle text-xs uppercase tracking-wide px-2 first:pl-0">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((t, i) => (
                  <tr key={t.id} className="border-b border-border/50">
                    <td className="py-2.5 px-2 pl-0">
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => handleMove(i, -1)}
                          disabled={i === 0 || busyId === t.id}
                          className="p-1 rounded-md text-fg-subtle hover:bg-muted hover:text-fg disabled:opacity-30"
                          title="Move up"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleMove(i, 1)}
                          disabled={i === sorted.length - 1 || busyId === t.id}
                          className="p-1 rounded-md text-fg-subtle hover:bg-muted hover:text-fg disabled:opacity-30"
                          title="Move down"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-fg font-medium">{t.label}</td>
                    <td className="py-2.5 px-2">
                      {t.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Disabled</Badge>}
                    </td>
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(t)} disabled={busyId === t.id} className="p-1.5 rounded-md text-fg-subtle hover:bg-muted hover:text-fg disabled:opacity-50" title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => handleToggleActive(t)} disabled={busyId === t.id} className="p-1.5 rounded-md text-fg-subtle hover:bg-muted hover:text-fg disabled:opacity-50" title={t.isActive ? 'Disable' : 'Enable'}>
                          {t.isActive ? <Ban className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        </button>
                        <button onClick={() => handleRemove(t)} disabled={busyId === t.id} className="p-1.5 rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger disabled:opacity-50" title="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TemplateModal
        open={modal}
        onClose={() => setModal(false)}
        editing={editing}
        onSave={handleSave}
        saving={createTemplate.isPending || updateTemplate.isPending}
      />
    </Card>
  );
}
