import { Sparkles } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { Card } from './Card';
import { EmptyState } from './EmptyState';

export function ComingSoon({ title, subtitle }) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} subtitle={subtitle} />
      <Card className="py-6">
        <EmptyState icon={Sparkles} title="Module in progress" message="This module is being built out." />
      </Card>
    </div>
  );
}
