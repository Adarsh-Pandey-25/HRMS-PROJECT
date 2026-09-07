import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { Card, Button, Badge, Skeleton, PageHeader, Modal, Input, Field } from '../../components/ui';
import { formatDateTime } from '../../lib/utils';
import { listCouponsApi, createCouponApi, deactivateCouponApi } from '../../api/subscription.api';

export default function Coupons() {
  const qc = useQueryClient();
  const { data: coupons = [], isLoading } = useQuery({ queryKey: ['super-admin', 'coupons'], queryFn: listCouponsApi });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ code: '', discount_type: 'percent', discount_value: '', max_redemptions: '', valid_until: '' });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['super-admin', 'coupons'] });

  const submit = async () => {
    if (!form.code || !form.discount_value) {
      toast.error('Code and discount value are required');
      return;
    }
    setBusy(true);
    try {
      await createCouponApi({
        code: form.code,
        discount_type: form.discount_type,
        discount_value: Number(form.discount_value),
        max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
        valid_until: form.valid_until || null,
      });
      toast.success('Coupon created');
      setOpen(false);
      setForm({ code: '', discount_type: 'percent', discount_value: '', max_redemptions: '', valid_until: '' });
      await invalidate();
    } catch (err) {
      toast.error(err.message || 'Could not create coupon');
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (id) => {
    try {
      await deactivateCouponApi(id);
      await invalidate();
    } catch (err) {
      toast.error(err.message || 'Could not deactivate coupon');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <PageHeader title="Coupons" subtitle="Discount codes for subscription signups." actions={<Button icon={Plus} onClick={() => setOpen(true)}>New coupon</Button>} />
      <Card>
        <div className="overflow-x-auto px-5 pb-5 pt-5">
          {isLoading ? <Skeleton className="h-48 w-full rounded-xl" /> : coupons.length === 0 ? (
            <p className="text-sm text-fg-subtle py-8 text-center">No coupons yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['Code', 'Discount', 'Redemptions', 'Valid until', 'Status', ''].map((h) => (
                    <th key={h || 'actions'} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coupons.map((c) => (
                  <tr key={c.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-3 font-mono font-medium text-fg">{c.code}</td>
                    <td className="py-2.5 pr-3 text-fg-muted">{c.discountType === 'percent' ? `${c.discountValue}%` : `₹${c.discountValue}`}</td>
                    <td className="py-2.5 pr-3 text-fg-muted">{c.timesRedeemed}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}</td>
                    <td className="py-2.5 pr-3 text-fg-subtle text-xs">{c.validUntil ? formatDateTime(c.validUntil) : 'No expiry'}</td>
                    <td className="py-2.5 pr-3"><Badge tone={c.isActive ? 'success' : 'neutral'}>{c.isActive ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="py-2.5 text-right">
                      {c.isActive && <Button size="sm" variant="outline" onClick={() => deactivate(c.id)}>Deactivate</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New coupon"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={submit}>Create</Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <Input label="Code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} />
          <Field label="Discount type">
            <select
              value={form.discount_type}
              onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value }))}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="percent">Percent</option>
              <option value="flat">Flat (INR)</option>
            </select>
          </Field>
          <Input label="Discount value" type="number" value={form.discount_value} onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))} />
          <Input label="Max redemptions (optional)" type="number" value={form.max_redemptions} onChange={(e) => setForm((f) => ({ ...f, max_redemptions: e.target.value }))} />
          <Input label="Valid until (optional)" type="date" value={form.valid_until} onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))} />
        </div>
      </Modal>
    </div>
  );
}
