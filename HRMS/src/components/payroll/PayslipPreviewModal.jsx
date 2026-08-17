import { Download } from 'lucide-react';
import { Modal, Button } from '../ui';
import { PayslipDocument } from './PayslipDocument';
import { downloadPayslipApi } from '../../hooks/usePayroll';
import toast from 'react-hot-toast';
import { formatDate } from '../../lib/utils';

export function PayslipPreviewModal({ open, onClose, payslip, employeeName, company, employee }) {
  if (!payslip) return null;

  const monthKey = String(payslip.month || '').includes('-')
    ? `${payslip.month}-01`
    : `${payslip.year}-${String(payslip.monthNum || payslip.month || 1).padStart(2, '0')}-01`;
  const monthLabel = formatDate(monthKey, 'MMMM yyyy');
  const status = String(payslip.payslipStatus || payslip.status || 'draft');
  const isPublished = status.toLowerCase() === 'published';
  const companyName = company?.name || company?.legalName || 'Company';

  const handleDownload = async () => {
    if (!isPublished) {
      toast.error('Publish the payslip before downloading the PDF');
      return;
    }
    try {
      await downloadPayslipApi(payslip.id);
    } catch (err) {
      toast.error(err.message || 'Failed to download payslip');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={employeeName ? `Payslip — ${employeeName}` : 'Payslip'}
      subtitle={`${companyName} · ${monthLabel}`}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button icon={Download} onClick={handleDownload} disabled={!isPublished}>
            Download PDF
          </Button>
        </>
      )}
    >
      <PayslipDocument
        payslip={payslip}
        company={company}
        employee={employee}
      />
    </Modal>
  );
}
