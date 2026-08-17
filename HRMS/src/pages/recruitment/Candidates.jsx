import { useState } from 'react';
import { Star, Clock, Mail, Phone, Briefcase, CalendarClock, Send, X } from 'lucide-react';
import { PageHeader, Card, Avatar, StatusBadge, Badge, Button, Drawer, Skeleton } from '../../components/ui';
import { KanbanBoard } from '../../components/shared/KanbanBoard';
import { KANBAN_STAGES } from '../../data';
import { useCandidates, useJobs, useRecruitmentMutations } from '../../hooks/useModules';
import { useSettingsStore } from '../../store/settingsStore';
import { formatDate, humanize } from '../../lib/utils';
import toast from 'react-hot-toast';

const SOURCE_TONE = {
  LinkedIn: 'info', Referral: 'success', Portal: 'primary', Naukri: 'warning',
};

const toStageId = (label) => String(label || '').trim().toLowerCase().replace(/\s+/g, '-');

function pipelineColumns(stages) {
  const labels = (Array.isArray(stages) ? stages : [])
    .map((s) => String(s).trim())
    .filter((s) => s && toStageId(s) !== 'rejected');
  if (!labels.length) return KANBAN_STAGES;
  return labels.map((label) => ({ id: toStageId(label), label }));
}

function CandidateCard({ c }) {
  return (
    <div className="rounded-xl bg-card border border-border/70 p-3 shadow-sm hover:shadow-card transition-shadow">
      <div className="flex items-center gap-2.5">
        <Avatar name={c.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg truncate">{c.name}</p>
          <p className="text-xs text-fg-subtle">{c.experience ? `${c.experience}y exp` : c.email}</p>
        </div>
      </div>
      {c.source && (
        <div className="mt-2.5 flex items-center justify-between">
          <Badge tone={SOURCE_TONE[c.source] || 'neutral'}>{c.source}</Badge>
          {c.rating != null && (
            <div className="flex items-center gap-0.5 text-warning">
              <Star className="h-3.5 w-3.5 fill-current" />
              <span className="text-xs font-medium text-fg">{c.rating}</span>
            </div>
          )}
        </div>
      )}
      <p className="mt-2 flex items-center gap-1 text-[11px] text-fg-subtle">
        <Clock className="h-3 w-3" /> {c.daysInStage}d in stage
      </p>
    </div>
  );
}

export default function Candidates() {
  const { data: candidates = [], isLoading } = useCandidates();
  const { data: jobs = [] } = useJobs();
  const { moveCandidate } = useRecruitmentMutations();
  const recruitmentStages = useSettingsStore((s) => s.recruitmentConfig?.stages);
  const columns = pipelineColumns(recruitmentStages);
  const [selected, setSelected] = useState(null);

  const handleMove = async (id, stage) => {
    const c = candidates.find((x) => x.id === id);
    try {
      await moveCandidate.mutateAsync({ id, stage });
      toast.success(`${c?.name} → ${humanize(stage)}`);
    } catch (err) {
      toast.error(err.message || 'Failed to move candidate');
    }
  };

  const jobTitle = selected ? jobs.find((j) => j.id === selected.jobId)?.title : null;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Candidates" subtitle="Applicant pipeline across all open roles" />

      <Card className="p-4">
        <p className="text-xs text-fg-subtle mb-3">Drag candidates between stages to update their status.</p>
        {isLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : (
          <KanbanBoard
            columns={columns}
            items={candidates.filter((c) => c.stage !== 'rejected')}
            onMove={handleMove}
            onCardClick={setSelected}
            renderCard={(c) => <CandidateCard c={c} />}
          />
        )}
      </Card>

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name}
        subtitle={jobTitle}
        footer={
          selected && (
            <>
              <Button variant="danger-ghost" icon={X} onClick={() => { handleMove(selected.id, 'rejected'); setSelected(null); }}>Reject</Button>
              <Button icon={Send} onClick={() => { toast.success(`Offer workflow for ${selected.name}`); setSelected(null); }}>Send Offer</Button>
            </>
          )
        }
      >
        {selected && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Avatar name={selected.name} size="lg" />
              <div>
                <StatusBadge status={selected.stage?.replace(/_/g, '-')} />
                <p className="text-sm text-fg-muted mt-1">Applied {selected.appliedOn ? formatDate(selected.appliedOn) : '—'}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              {selected.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-fg-subtle" /> {selected.email}</p>}
              {selected.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-fg-subtle" /> {selected.phone}</p>}
              {jobTitle && <p className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-fg-subtle" /> {jobTitle}</p>}
              <p className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-fg-subtle" /> {selected.daysInStage} days in current stage</p>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
