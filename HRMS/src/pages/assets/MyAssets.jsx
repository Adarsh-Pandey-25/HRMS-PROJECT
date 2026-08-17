import { useNavigate } from 'react-router-dom';
import { Monitor, Laptop, Smartphone, Tablet, Armchair, Mouse, Package } from 'lucide-react';
import { PageHeader, Card, Button, StatusBadge, EmptyState, Skeleton } from '../../components/ui';
import { useMyAssets } from '../../hooks/useModules';
import { formatDate } from '../../lib/utils';

const CAT_ICON = {
  Laptop, Phone: Smartphone, Tablet, Monitor, Furniture: Armchair, Peripheral: Mouse,
};

export default function MyAssets() {
  const navigate = useNavigate();
  const { data: myAssets = [], isLoading } = useMyAssets();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="My Assets" subtitle="Company equipment assigned to you" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? (
          <Skeleton className="h-32 md:col-span-2 rounded-card" />
        ) : myAssets.length === 0 ? (
          <Card className="py-6 md:col-span-2"><EmptyState icon={Monitor} title="No assets assigned" message="You don't have any company assets yet." /></Card>
        ) : myAssets.map((a) => {
          const Icon = CAT_ICON[a.category] || Package;
          const subject = encodeURIComponent(`Asset issue: ${a.name || a.serialNumber || a.id}`);
          return (
            <Card key={a.id} className="p-5">
              <div className="flex items-start gap-4">
                <div className="h-14 w-14 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Icon className="h-7 w-7" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-fg">{a.name}</p>
                  <p className="text-xs text-fg-subtle mt-0.5">{a.brand} · {a.serialNumber}</p>
                  <p className="text-xs text-fg-subtle">Assigned {a.assignedOn ? formatDate(a.assignedOn) : '—'}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/helpdesk/new?subject=${subject}&category=assets`)}
                    >
                      Return
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/helpdesk/new?subject=${subject}&category=assets`)}
                    >
                      Report Issue
                    </Button>
                  </div>
                </div>
                <StatusBadge status={a.status} dot={false} />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
