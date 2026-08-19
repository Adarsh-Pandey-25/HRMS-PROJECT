import { Plus, Trash2 } from 'lucide-react';
import { Input, Textarea, Button } from '../ui';
import { newDirector, newFounder } from '../../lib/companyLegal';

export function CompanyLegalFields({ form, setForm }) {
  const patch = (partial) => setForm((f) => ({ ...f, ...partial }));

  const updatePerson = (key, id, field, value) => {
    setForm((f) => ({
      ...f,
      [key]: (f[key] || []).map((p) => (p.id === id ? { ...p, [field]: value } : p)),
    }));
  };

  const removePerson = (key, id) => {
    setForm((f) => ({ ...f, [key]: (f[key] || []).filter((p) => p.id !== id) }));
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Legal / registered name"
          placeholder="As on MCA / GST certificate"
          value={form.legalName || ''}
          onChange={(e) => patch({ legalName: e.target.value })}
        />
        <Input
          label="GSTIN"
          placeholder="e.g. 27AAAAA0000A1Z5"
          value={form.gstin || ''}
          onChange={(e) => patch({ gstin: e.target.value.toUpperCase() })}
        />
        <Input
          label="PAN"
          placeholder="e.g. AAAAA0000A"
          value={form.pan || ''}
          onChange={(e) => patch({ pan: e.target.value.toUpperCase() })}
        />
        <Input
          label="CIN"
          placeholder="Company Identification Number"
          value={form.cin || ''}
          onChange={(e) => patch({ cin: e.target.value.toUpperCase() })}
        />
        <Input
          label="TAN"
          placeholder="Optional"
          value={form.tan || ''}
          onChange={(e) => patch({ tan: e.target.value.toUpperCase() })}
        />
        <Input
          label="Date of incorporation"
          type="date"
          value={form.incorporationDate || ''}
          onChange={(e) => patch({ incorporationDate: e.target.value })}
        />
        <Textarea
          label="Nature of business"
          containerClass="sm:col-span-2"
          rows={2}
          placeholder="e.g. Digital advertising and media services"
          value={form.natureOfBusiness || ''}
          onChange={(e) => patch({ natureOfBusiness: e.target.value })}
        />
      </div>

      <PeopleBlock
        title="Directors"
        hint="Name, DIN, and designation as on company records."
        items={form.directors || []}
        emptyLabel="Add director"
        onAdd={() => patch({ directors: [...(form.directors || []), newDirector()] })}
        onRemove={(id) => removePerson('directors', id)}
        renderFields={(p) => (
          <>
            <Input placeholder="Full name" value={p.name} onChange={(e) => updatePerson('directors', p.id, 'name', e.target.value)} />
            <Input placeholder="DIN" value={p.din} onChange={(e) => updatePerson('directors', p.id, 'din', e.target.value)} />
            <Input placeholder="Designation" value={p.designation} onChange={(e) => updatePerson('directors', p.id, 'designation', e.target.value)} />
          </>
        )}
      />

      <PeopleBlock
        title="Founders"
        hint="Promoters or founding members."
        items={form.founders || []}
        emptyLabel="Add founder"
        onAdd={() => patch({ founders: [...(form.founders || []), newFounder()] })}
        onRemove={(id) => removePerson('founders', id)}
        renderFields={(p) => (
          <>
            <Input placeholder="Full name" value={p.name} onChange={(e) => updatePerson('founders', p.id, 'name', e.target.value)} />
            <Input placeholder="Role" value={p.role} onChange={(e) => updatePerson('founders', p.id, 'role', e.target.value)} />
          </>
        )}
      />
    </div>
  );
}

function PeopleBlock({ title, hint, items, emptyLabel, onAdd, onRemove, renderFields }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <p className="text-sm font-semibold text-fg">{title}</p>
          <p className="text-xs text-fg-subtle">{hint}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" />
          {emptyLabel}
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-fg-subtle rounded-lg border border-dashed border-border px-3 py-3">None added yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((p) => (
            <li key={p.id} className="flex items-start gap-2 rounded-lg border border-border p-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1 min-w-0">
                {renderFields(p)}
              </div>
              <button
                type="button"
                aria-label="Remove"
                onClick={() => onRemove(p.id)}
                className="mt-1.5 text-fg-subtle hover:text-danger shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
