import toast from 'react-hot-toast';
import { Copy } from 'lucide-react';
import { workspaceUrl } from '../../lib/host';

/** The three login pages every company gets on its own subdomain. */
const PORTAL_LINKS = [
  { path: '/', label: 'Employees' },
  { path: '/admin', label: 'Admin' },
  { path: '/hr', label: 'HR' },
];

const portalUrl = (slug, path) => {
  const origin = workspaceUrl(slug);
  if (!origin) return '';
  return path === '/' ? `${origin}/` : `${origin}${path}`;
};

const copy = async (url) => {
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Link copied');
  } catch {
    toast.error('Could not copy — select the link and copy it manually');
  }
};

/**
 * `compact` renders three small copy buttons (for table rows); otherwise
 * each link is shown in full with its own copy button.
 */
export function PortalLinks({ slug, compact = false }) {
  if (!slug) return null;
  if (!workspaceUrl(slug)) {
    return <span className="text-xs text-fg-subtle">Base domain not configured</span>;
  }

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
        {PORTAL_LINKS.map(({ path, label }) => (
          <button
            key={path}
            type="button"
            title={portalUrl(slug, path)}
            onClick={() => copy(portalUrl(slug, path))}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-fg-muted hover:border-primary hover:text-primary"
          >
            <Copy className="h-3 w-3" /> {label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {PORTAL_LINKS.map(({ path, label }) => {
        const url = portalUrl(slug, path);
        return (
          <div key={path} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-fg-subtle">{label} login</div>
              <div className="text-sm font-mono text-fg truncate">{url}</div>
            </div>
            <button
              type="button"
              onClick={() => copy(url)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-fg-muted hover:bg-primary/10 hover:text-primary"
            >
              <Copy className="h-4 w-4" /> Copy
            </button>
          </div>
        );
      })}
    </div>
  );
}
