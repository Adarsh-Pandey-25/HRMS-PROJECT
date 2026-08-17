import { Inbox } from 'lucide-react';
import { cn } from '../../lib/utils';

export function EmptyState({ icon: Icon = Inbox, title = 'Nothing here', message, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center px-6 py-10', className)}>
      <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <Icon className="h-7 w-7 text-primary" />
      </div>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {message && <p className="mt-1 text-sm text-fg-subtle max-w-xs">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
