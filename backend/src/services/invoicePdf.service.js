const PDFDocument = require('pdfkit');

/**
 * Section F: "generate via whatever PDF library is already used for
 * payslips if invoice PDFs don't already exist" — pdfkit, same as
 * payslipPdf.service.js. Generated on demand, not stored (invoices are
 * small/simple compared to payslips — no need for the storage-bucket
 * round trip that file does).
 */
const fmt = (n) => `INR ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const generateInvoicePdf = (invoice, companyName) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text('Invoice', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#555').text(`Invoice #: ${invoice.invoice_number}`);
    doc.text(`Issued: ${new Date(invoice.issued_at).toLocaleDateString('en-IN')}`);
    if (invoice.paid_at) doc.text(`Paid: ${new Date(invoice.paid_at).toLocaleDateString('en-IN')}`);
    doc.text(`Status: ${invoice.status}`);
    doc.moveDown(1);
    doc.fontSize(12).fillColor('#000').text(`Billed to: ${companyName || 'Company'}`);
    doc.moveDown(1);

    doc.fontSize(11).text('Line items:', { underline: true });
    doc.moveDown(0.3);
    for (const item of Array.isArray(invoice.line_items) ? invoice.line_items : []) {
      doc.fontSize(10).text(`${item.description || item.type || 'Item'}`, { continued: true });
      doc.text(fmt(item.amount), { align: 'right' });
    }
    doc.moveDown(1);
    doc.fontSize(13).text(`Total: ${fmt(invoice.amount)}`, { align: 'right' });
    if (invoice.payment_method) doc.moveDown(0.5).fontSize(9).fillColor('#666').text(`Payment method: ${invoice.payment_method}`, { align: 'right' });
    if (invoice.payment_reference) doc.fontSize(9).text(`Reference: ${invoice.payment_reference}`, { align: 'right' });

    doc.end();
  });

module.exports = { generateInvoicePdf };
