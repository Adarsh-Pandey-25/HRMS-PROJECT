import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader, Card, CardHeader, Badge, Button, Input, Modal, EmptyState, Skeleton } from '../../components/ui';
import { useAssetCategories, useAssets, useAssetMutations } from '../../hooks/useModules';
import toast from 'react-hot-toast';

export default function AssetCategories() {
  const { data: categories = [], isLoading } = useAssetCategories();
  const { data: assets = [] } = useAssets();
  const { createCategory } = useAssetMutations();
  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');

  const countFor = (cat) => assets.filter((a) => (a.category || '').toLowerCase() === String(cat).toLowerCase()).length;

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return toast.error('Category name is required');
    try {
      await createCategory.mutateAsync({ name: trimmed });
      toast.success('Category added');
      setModal(false);
      setName('');
    } catch (err) {
      toast.error(err.message || 'Failed to add category');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Asset Categories"
        subtitle="Organize inventory by equipment type"
        actions={<Button icon={Plus} onClick={() => setModal(true)}>Add Category</Button>}
      />

      <Card>
        <CardHeader title="Categories" subtitle={`${categories.length} categories`} />
        <div className="p-5 pt-3 space-y-2">
          {isLoading ? (
            [1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)
          ) : categories.length === 0 ? (
            <EmptyState title="No categories yet" message="Add a category or create an asset in Inventory — categories are saved automatically." />
          ) : categories.map((cat) => {
            const label = typeof cat === 'string' ? cat : cat.name || cat.label;
            return (
              <div key={cat.id || label} className="flex items-center justify-between rounded-xl border border-border/60 p-3">
                <div className="flex items-center gap-3">
                  <Badge tone="neutral">{label}</Badge>
                  <span className="text-xs text-fg-subtle">{countFor(label)} assets</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Add Category"
        footer={<><Button variant="outline" onClick={() => setModal(false)}>Cancel</Button><Button onClick={save} disabled={createCategory.isPending}>Save</Button></>}
      >
        <Input label="Category name" placeholder="e.g. Laptop" value={name} onChange={(e) => setName(e.target.value)} />
      </Modal>
    </div>
  );
}
