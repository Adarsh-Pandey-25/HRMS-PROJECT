import { useNavigate } from 'react-router-dom';
import { ArrowRight, Users, Clock, DollarSign, Sparkles } from 'lucide-react';
import { Button } from '../components/ui';

const HIGHLIGHTS = [
  { icon: Users, label: 'Employee lifecycle, end to end' },
  { icon: Clock, label: 'Attendance across web, app & biometric' },
  { icon: DollarSign, label: 'Payroll, leave & expenses in one place' },
];

export default function Welcome() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-light via-page to-primary-light px-4 animate-fade-in">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto mb-6 h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-card-hover">
          <span className="text-white font-bold text-2xl leading-none">H</span>
        </div>

        <h1 className="text-3xl font-semibold text-fg">SPAXADS HRMS</h1>
        <p className="mt-2 text-base text-fg-muted">Modern HR, simplified. Sign in to your company workspace.</p>

        <div className="mt-8 space-y-2.5 text-left">
          {HIGHLIGHTS.map((h) => (
            <div key={h.label} className="flex items-center gap-3 rounded-input bg-card border border-border/60 shadow-card px-4 py-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <h.icon className="h-4 w-4" />
              </div>
              <span className="text-sm text-fg">{h.label}</span>
            </div>
          ))}
        </div>

        <Button size="lg" className="mt-8 w-full" icon={ArrowRight} onClick={() => navigate('/login')}>
          Sign in
        </Button>

        <p className="mt-4 text-xs text-fg-subtle">
          New company? You need a one-time onboarding link from your platform administrator.
        </p>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-fg-subtle">
          <Sparkles className="h-3.5 w-3.5" /> Secure invite-only workspace setup
        </p>
      </div>
    </div>
  );
}
