import { Building2 } from 'lucide-react';
import { getHostInfo, platformUrl } from '../lib/host';

/** Shown on a subdomain that has no company behind it (typo, removed workspace, reserved name). */
export default function WorkspaceNotFound() {
  const { slug } = getHostInfo();
  return (
    <main className="min-h-screen flex items-center justify-center bg-page px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 h-14 w-14 rounded-2xl bg-primary-light flex items-center justify-center">
          <Building2 className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold text-fg">Workspace not found</h1>
        <p className="mt-3 text-sm text-fg-muted">
          {slug
            ? <>There is no SpaxSync workspace at <span className="font-mono text-fg">{slug}</span>. Check the address in the email from your company, or ask your HR team for the right link.</>
            : 'This address is not a SpaxSync workspace. Check the link your company sent you.'}
        </p>
        <a
          href={platformUrl()}
          className="mt-8 inline-flex items-center justify-center rounded-input bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-dark"
        >
          Go to spaxsync.com
        </a>
      </div>
    </main>
  );
}
