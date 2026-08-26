import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { PageHeader, Card, CardHeader, Avatar, StatusBadge, EmptyState, Skeleton, Select } from '../../components/ui';
import { useOffers, useJobs, useCandidateChecklist, useToggleCandidateChecklistItem } from '../../hooks/useModules';
import { formatCurrency } from '../../lib/utils';

export default function Offers() {
  const { data: offers = [], isLoading: offersLoading } = useOffers();
  const { data: jobs = [] } = useJobs();
  const jobTitle = (jobId) => jobs.find((j) => j.id === jobId)?.title || 'Role';

  // Onboarding Checklist is per-candidate. Accepted offers are the candidates
  // who actually need onboarding, so that's the pool to pick from — default
  // to the most recently accepted one, with a selector when there's more
  // than one so HR can switch between them.
  const acceptedOffers = offers.filter((o) => o.status === 'accepted');
  const [selectedCandidateId, setSelectedCandidateId] = useState('');

  useEffect(() => {
    if (!acceptedOffers.length) {
      if (selectedCandidateId) setSelectedCandidateId('');
      return;
    }
    const stillValid = acceptedOffers.some((o) => (o.candidateId || o.candidate_id) === selectedCandidateId);
    if (!stillValid) setSelectedCandidateId(acceptedOffers[0].candidateId || acceptedOffers[0].candidate_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offers.length]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Offers" subtitle="Offer letters and onboarding checklist" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Offer Letters" subtitle="Sent & pending acceptance" />
          <div className="p-5 pt-3 space-y-2">
            {offersLoading ? (
              [1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)
            ) : offers.length === 0 ? (
              <EmptyState title="No offers" message="No offers extended yet." />
            ) : offers.map((o) => (
              <div key={o.id} className="flex items-center gap-3 rounded-xl border border-border/60 p-3">
                <Avatar name={o.candidateName || o.candidate_name || 'Candidate'} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-fg">{o.candidateName || o.candidate_name || 'Candidate'}</p>
                  <p className="text-xs text-fg-subtle">
                    {o.designation || jobTitle(o.jobId || o.job_id)}
                    {o.amount != null && ` · ${formatCurrency(o.amount, o.currency || 'INR')}`}
                  </p>
                  {o.joiningDate || o.joining_date ? (
                    <p className="text-[11px] text-fg-subtle mt-0.5">Joining {o.joiningDate || o.joining_date}</p>
                  ) : null}
                </div>
                <StatusBadge
                  status={o.status === 'accepted' ? 'approved' : 'pending'}
                  label={o.status === 'accepted' ? 'Accepted' : humanizeStatus(o.status)}
                />
              </div>
            ))}
          </div>
        </Card>

        <OnboardingChecklistCard
          acceptedOffers={acceptedOffers}
          selectedCandidateId={selectedCandidateId}
          onSelectCandidate={setSelectedCandidateId}
          offersLoading={offersLoading}
        />
      </div>
    </div>
  );
}

function OnboardingChecklistCard({ acceptedOffers, selectedCandidateId, onSelectCandidate, offersLoading }) {
  const { data: checklist = [], isLoading: checklistLoading } = useCandidateChecklist(selectedCandidateId);
  const toggleItem = useToggleCandidateChecklistItem(selectedCandidateId);

  const handleToggle = async (item, checked) => {
    try {
      await toggleItem.mutateAsync({ templateId: item.templateId, isChecked: checked });
    } catch (err) {
      toast.error(err.message || 'Failed to update checklist item');
    }
  };

  const selectedCandidateName = acceptedOffers.find(
    (o) => (o.candidateId || o.candidate_id) === selectedCandidateId
  )?.candidateName;

  return (
    <Card>
      <CardHeader
        title="Onboarding Checklist"
        subtitle={selectedCandidateName ? `For ${selectedCandidateName}` : 'For accepted candidates'}
      />
      <div className="p-5 pt-3 space-y-3">
        {offersLoading ? (
          <Skeleton className="h-10 rounded-xl" />
        ) : acceptedOffers.length === 0 ? (
          <EmptyState title="No accepted offers yet" message="A candidate's onboarding checklist appears here once their offer is accepted." />
        ) : (
          <>
            {acceptedOffers.length > 1 && (
              <Select
                value={selectedCandidateId}
                onChange={(e) => onSelectCandidate(e.target.value)}
                options={acceptedOffers.map((o) => ({
                  value: o.candidateId || o.candidate_id,
                  label: o.candidateName || o.candidate_name || 'Candidate',
                }))}
              />
            )}
            <div className="space-y-2">
              {checklistLoading ? (
                [1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)
              ) : checklist.length === 0 ? (
                <EmptyState title="No checklist items" message="Add items under Settings > Onboarding Checklist." />
              ) : (
                checklist.map((item) => (
                  <label
                    key={item.templateId}
                    className="flex items-center gap-3 rounded-xl border border-border/60 p-3 cursor-pointer hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={item.isChecked}
                      disabled={toggleItem.isPending}
                      onChange={(e) => handleToggle(item, e.target.checked)}
                      className="h-4 w-4 accent-[#6C63FF]"
                    />
                    <span className="text-sm text-fg">{item.label}</span>
                  </label>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function humanizeStatus(s) {
  if (!s) return 'Pending';
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
