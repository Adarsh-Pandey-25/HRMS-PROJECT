import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Card } from '../../components/ui';
import { BulkImportPanel } from '../../components/shared/BulkImportPanel';

export default function EmployeeImport() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      <button type="button" onClick={() => navigate('/employees')} className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Employees
      </button>

      <div>
        <h1 className="text-page-title text-fg">Bulk Import</h1>
        <p className="mt-1 text-sm text-fg-muted">Add many employees at once from a CSV file. Each valid row is created via the employees API.</p>
      </div>

      <Card className="p-6">
        <BulkImportPanel onImported={() => navigate('/employees')} />
      </Card>
    </div>
  );
}
