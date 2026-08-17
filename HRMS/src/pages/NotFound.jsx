import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '../components/ui';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
        <Compass className="h-8 w-8 text-primary" />
      </div>
      <p className="text-page-title text-fg">Page not found</p>
      <p className="mt-2 text-sm text-fg-muted max-w-sm">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link to="/dashboard" className="mt-6">
        <Button>Back to Dashboard</Button>
      </Link>
    </div>
  );
}
