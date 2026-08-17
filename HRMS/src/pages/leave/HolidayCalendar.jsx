import { PageHeader, Card, CardHeader, EmptyState, Skeleton } from '../../components/ui';
import { useQuery } from '@tanstack/react-query';
import { fetchHolidaysByYearApi } from '../../api/holidays.api';
import { formatDate } from '../../lib/utils';
import { Palmtree } from 'lucide-react';

export default function HolidayCalendar() {
  const year = new Date().getFullYear();
  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => fetchHolidaysByYearApi(year),
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Holiday Calendar" subtitle={`Company holidays · ${year}`} />
      <Card>
        <CardHeader title={`${year} holidays`} subtitle="Managed from Settings → Leave Policy" />
        <div className="p-5 pt-3 space-y-3">
          {isLoading ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : holidays.length === 0 ? (
            <EmptyState icon={Palmtree} title="No holidays" message="Add holidays in Settings → Leave Policy." />
          ) : holidays.map((h) => (
            <div key={h.id || h.name} className="flex items-center justify-between rounded-xl border border-border/60 p-3">
              <div>
                <p className="text-sm font-medium text-fg">{h.name}</p>
                <p className="text-xs text-fg-subtle capitalize">{h.type}</p>
              </div>
              <span className="text-sm text-fg-muted">{formatDate(h.date, 'dd MMM yyyy')}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
