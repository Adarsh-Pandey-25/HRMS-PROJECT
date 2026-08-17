import { useMemo, useState } from 'react';
import { Plus, Megaphone } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, Card, Button, Input, Select, RichTextEditor, Modal, FileUpload,
  AnnouncementCard, EmptyState, SearchInput,
} from '../components/ui';
import { useEmployeeMap } from '../hooks/useEmployees';
import { useAllAnnouncements, useActiveAnnouncements, useAnnouncementMutations } from '../hooks/useAnnouncements';
import { useAuthStore, useCurrentUser } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { humanize } from '../lib/utils';

const buildEmptyForm = (announcementConfig) => ({
  title: '',
  body: '',
  audienceType: 'all',
  audienceValue: [],
  specificIds: '',
  priority: 'medium',
  isPinned: false,
  isScheduled: false,
  scheduledAt: '',
  channels: {
    inApp: true,
    mobilePush: announcementConfig?.defaultChannels?.mobilePush ?? true,
    email: announcementConfig?.defaultChannels?.email ?? false,
  },
  attachments: [],
});

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Normal' },
  { value: 'high', label: 'Important' },
  { value: 'urgent', label: 'Urgent' },
];

const AUDIENCE_TYPES = [
  { value: 'all', label: 'All employees' },
  { value: 'employees', label: 'Employees only' },
  { value: 'managers', label: 'Managers' },
  { value: 'hr', label: 'HR' },
];

function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function mapAudienceForApi(form) {
  // Backend supports: all | hr | managers | employees
  if (['all', 'hr', 'managers', 'employees'].includes(form.audienceType)) {
    return form.audienceType;
  }
  if (form.audienceType === 'role' && form.audienceValue?.length) {
    const r = String(form.audienceValue[0]).toLowerCase();
    if (r === 'hr' || r === 'admin') return 'hr';
    if (r === 'manager') return 'managers';
    if (r === 'employee') return 'employees';
  }
  return 'all';
}

export default function Announcements() {
  const role = useAuthStore((s) => s.role);
  const user = useCurrentUser();
  const announcementConfig = useSettingsStore((s) => s.announcementConfig);
  const canCreate = ['admin', 'hr'].includes(role);

  const allQuery = useAllAnnouncements({}, { enabled: canCreate });
  const activeQuery = useActiveAnnouncements();
  const { create, acknowledge } = useAnnouncementMutations();
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(() => buildEmptyForm(announcementConfig));

  const employeeMap = useEmployeeMap();
  const announcements = canCreate ? (allQuery.data || []) : (activeQuery.data || []);
  const filtered = useMemo(
    () =>
      announcements
        .filter((a) => {
          // HR/Admin see drafts too; others only published
          if (!canCreate && a.status === 'draft') return false;
          return true;
        })
        .filter((a) => !priority || a.priority === priority)
        .filter((a) => !search || a.title.toLowerCase().includes(search.toLowerCase())),
    [announcements, priority, search, canCreate]
  );

  const resetForm = () => setForm(buildEmptyForm(announcementConfig));

  const openCreateModal = () => {
    setForm(buildEmptyForm(announcementConfig));
    setModal(true);
  };

  const submit = async (status) => {
    if (!form.title.trim()) return toast.error('Title is required');
    if (!stripHtml(form.body)) return toast.error('Body is required');

    const priorityMap = {
      normal: 'medium',
      important: 'high',
      medium: 'medium',
      low: 'low',
      high: 'high',
      urgent: 'urgent',
    };

    try {
      const created = await create.mutateAsync({
        title: form.title.trim(),
        content: form.body,
        priority: priorityMap[form.priority] || 'medium',
        targetAudience: mapAudienceForApi(form),
        isActive: status === 'published' || status === 'scheduled',
        expiresAt: form.isScheduled && form.scheduledAt
          ? new Date(form.scheduledAt).toISOString()
          : undefined,
        department: form.audienceType === 'department' && form.audienceValue?.[0]
          ? form.audienceValue[0]
          : undefined,
        channels: form.channels,
      });
      setModal(false);
      resetForm();
      if (created?.pendingApproval) {
        toast.success('Announcement submitted for admin approval');
      } else {
        toast.success(status === 'published' ? 'Announcement published' : 'Announcement saved');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to save announcement');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Announcements"
        subtitle="Company-wide updates, delivered in-app, on mobile & by email"
        actions={canCreate && <Button icon={Plus} onClick={openCreateModal}>New Announcement</Button>}
      />

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search announcements…" className="flex-1" />
        <Select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          placeholder="All priorities"
          options={['low', 'medium', 'high', 'urgent'].map((p) => ({ value: p, label: humanize(p) }))}
          className="sm:w-48"
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={Megaphone} title="No announcements" message="Nothing matches your filters yet." />
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <AnnouncementCard
              key={a.id}
              announcement={a}
              author={employeeMap[a.createdBy] || { name: 'HR Team' }}
              isUnread={false}
              onOpen={(id) => acknowledge.mutate(id)}
            />
          ))}
        </div>
      )}

      {/* Create Announcement */}
      <Modal
        open={modal}
        onClose={() => { setModal(false); resetForm(); }}
        title="New Announcement"
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => submit('draft')}>Save Draft</Button>
            {form.isScheduled ? (
              <Button onClick={() => submit('scheduled')}>Schedule</Button>
            ) : (
              <Button onClick={() => submit('published')}>Publish Now</Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Title" required maxLength={100}
            placeholder="e.g. Office closed on July 14"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            hint={`${form.title.length}/100`}
          />

          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Body</label>
            <RichTextEditor
              key={modal ? 'announcement-body-open' : 'announcement-body-closed'}
              value={form.body}
              onChange={(v) => setForm((f) => ({ ...f, body: v }))}
              placeholder="Start typing your announcement here..."
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Audience" options={AUDIENCE_TYPES}
              value={form.audienceType}
              onChange={(e) => setForm((f) => ({ ...f, audienceType: e.target.value, audienceValue: [], specificIds: '' }))}
            />
            <Select
              label="Priority" options={PRIORITY_OPTIONS}
              value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-input border border-border p-4">
            <div>
              <p className="text-sm font-medium text-fg">Pin to top</p>
              <p className="text-xs text-fg-subtle">Pinned announcements always show first in the feed</p>
            </div>
            <input type="checkbox" checked={form.isPinned} onChange={(e) => setForm({ ...form, isPinned: e.target.checked })} className="h-5 w-5 accent-[#6C63FF]" />
          </div>

          <div className="rounded-input border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-fg">Schedule for later</p>
                <p className="text-xs text-fg-subtle">Pick a future date & time to auto-publish</p>
              </div>
              <input type="checkbox" checked={form.isScheduled} onChange={(e) => setForm({ ...form, isScheduled: e.target.checked })} className="h-5 w-5 accent-[#6C63FF]" />
            </div>
            {form.isScheduled && (
              <Input type="datetime-local" placeholder="DD-MM-YYYY --:--" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
            )}
          </div>

          <div className="rounded-input border border-border p-4 space-y-2.5">
            <p className="text-sm font-medium text-fg">Channels</p>
            <label className="flex items-center gap-2.5 text-sm text-fg-muted">
              <input type="checkbox" checked disabled className="h-4 w-4 accent-[#6C63FF]" /> In-app (web) — always on
            </label>
            <label className="flex items-center gap-2.5 text-sm text-fg-muted">
              <input type="checkbox" checked={form.channels.mobilePush} onChange={(e) => setForm({ ...form, channels: { ...form.channels, mobilePush: e.target.checked } })} className="h-4 w-4 accent-[#6C63FF]" /> Mobile app (push)
            </label>
            <label className="flex items-center gap-2.5 text-sm text-fg-muted">
              <input type="checkbox" checked={form.channels.email} onChange={(e) => setForm({ ...form, channels: { ...form.channels, email: e.target.checked } })} className="h-4 w-4 accent-[#6C63FF]" /> Email
            </label>
          </div>

          <div>
            <p className="text-xs font-medium text-fg-muted mb-1.5">Attachments (optional)</p>
            <FileUpload accept=".pdf,.jpg,.jpeg,.png" onChange={(files) => setForm({ ...form, attachments: files })} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
