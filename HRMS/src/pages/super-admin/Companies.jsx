import { Fragment, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronDown, ChevronRight, CornerDownRight, Power } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Badge, Skeleton } from '../../components/ui';
import { listAllCompaniesApi, setCompanyActiveApi } from '../../api/superAdmin.api';
import { formatDateTime } from '../../lib/utils';

export default function SuperAdminCompanies() {
  const qc = useQueryClient();
  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['super-admin', 'companies'],
    queryFn: listAllCompaniesApi,
  });
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  const { parentCompanies, childrenByParent, childCount } = useMemo(() => {
    const companyIds = new Set(companies.map((company) => company.id));
    const childMap = new Map();
    const parents = [];
    let children = 0;

    companies.forEach((company) => {
      const parentId = company.parentCompanyId ?? company.parent_company_id;
      if (parentId && companyIds.has(parentId)) {
        const siblings = childMap.get(parentId) || [];
        siblings.push(company);
        childMap.set(parentId, siblings);
        children += 1;
      } else {
        parents.push(company);
      }
    });

    return { parentCompanies: parents, childrenByParent: childMap, childCount: children };
  }, [companies]);

  const toggleExpanded = (companyId) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  };

  const toggle = async (c) => {
    const currentlyActive = Boolean(c.isActive ?? c.is_active);
    setBusyId(c.id);
    try {
      await setCompanyActiveApi(c.id, !currentlyActive);
      toast.success(currentlyActive ? 'Company deactivated' : 'Company activated');
      await qc.invalidateQueries({ queryKey: ['super-admin', 'companies'] });
    } catch (err) {
      toast.error(err.message || 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold text-fg flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" /> Companies
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          All tenant workspaces. Create new companies via an onboarding invite link.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Company groups"
          subtitle={isLoading
            ? 'Loading…'
            : `${parentCompanies.length} parent/standalone · ${childCount} child`}
        />
        <div className="overflow-x-auto px-5 pb-5">
          {isLoading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : companies.length === 0 ? (
            <p className="text-sm text-fg-subtle py-8 text-center">No companies yet. Generate an onboarding link to add one.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['Company', 'Employees', 'Status', 'Created', ''].map((h) => (
                    <th key={h || 'actions'} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parentCompanies.map((company) => {
                  const children = childrenByParent.get(company.id) || [];
                  const isExpanded = expanded.has(company.id);
                  const rows = [company, ...(isExpanded ? children : [])];

                  return (
                    <Fragment key={company.id}>
                      {rows.map((c, index) => {
                        const active = Boolean(c.isActive ?? c.is_active);
                        const isChild = index > 0;
                        return (
                          <tr
                            key={c.id}
                            className={isChild
                              ? 'border-b border-border/40 bg-muted/25'
                              : 'border-b border-border/60'}
                          >
                            <td className="py-3 pr-3">
                              <div className={`flex items-start gap-2 ${isChild ? 'pl-8' : ''}`}>
                                {isChild ? (
                                  <CornerDownRight className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
                                ) : children.length > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleExpanded(company.id)}
                                    className="mt-0.5 rounded p-0.5 text-fg-muted hover:bg-muted hover:text-primary"
                                    aria-label={isExpanded ? 'Collapse child companies' : 'Expand child companies'}
                                  >
                                    {isExpanded
                                      ? <ChevronDown className="h-4 w-4" />
                                      : <ChevronRight className="h-4 w-4" />}
                                  </button>
                                ) : (
                                  <span className="w-5" />
                                )}
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium text-fg">{c.name}</span>
                                    {!isChild && children.length > 0 && (
                                      <Badge tone="info">
                                        {children.length} {children.length === 1 ? 'child' : 'children'}
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="mt-0.5 font-mono text-[11px] text-fg-subtle">{c.slug}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 pr-3 text-fg-muted">
                              {c.employeeCount ?? c.employee_count ?? 0}
                            </td>
                            <td className="py-3 pr-3">
                              <Badge tone={active ? 'success' : 'neutral'}>
                                {active ? 'Active' : 'Inactive'}
                              </Badge>
                            </td>
                            <td className="py-3 pr-3 text-fg-subtle text-xs">
                              {formatDateTime(c.createdAt || c.created_at)}
                            </td>
                            <td className="py-3 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                icon={Power}
                                loading={busyId === c.id}
                                onClick={() => toggle(c)}
                              >
                                {active ? 'Deactivate' : 'Activate'}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
