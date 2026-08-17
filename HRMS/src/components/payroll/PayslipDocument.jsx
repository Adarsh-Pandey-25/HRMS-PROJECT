import { buildPayslipView } from '../../lib/payslipView';

function money(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Cell({ children, className = '', align = 'left', bold = false }) {
  return (
    <td
      className={[
        'border border-black px-2 py-1.5 text-[12px] leading-snug text-black',
        align === 'right' ? 'text-right tabular-nums' : align === 'center' ? 'text-center' : 'text-left',
        bold ? 'font-semibold' : 'font-normal',
        className,
      ].join(' ')}
    >
      {children}
    </td>
  );
}

/** Classic bordered Indian payslip sheet (matches downloaded PDF). */
export function PayslipDocument({ payslip, company, employee }) {
  if (!payslip) return null;
  const v = buildPayslipView(payslip, { company, employee });
  const brandInitial = String(v.brand || 'C').charAt(0).toUpperCase();

  return (
    <div className="overflow-x-auto bg-white text-black">
      <table className="w-full min-w-[640px] border-collapse border border-black">
        <tbody>
          <tr>
            <td colSpan={2} className="border border-black px-3 py-3 align-middle">
              <div className="flex items-center gap-3">
                {v.logoUrl ? (
                  <img src={v.logoUrl} alt="" className="h-10 w-10 object-contain" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded bg-black text-sm font-bold text-white">
                    {brandInitial}
                  </span>
                )}
                <span className="text-lg font-bold">{v.brand}</span>
              </div>
            </td>
            <td colSpan={2} className="border border-black px-3 py-3 align-middle">
              <p className="text-sm font-semibold">{v.legalName}</p>
              {v.address ? <p className="mt-1 text-xs text-neutral-700">{v.address}</p> : null}
            </td>
          </tr>
          <tr>
            <td colSpan={4} className="border border-black py-2 text-center text-sm font-semibold">
              Payslip for the Month of {v.period}
            </td>
          </tr>
          <tr>
            <td colSpan={2} className="border border-black px-3 py-3 align-top">
              <p className="mb-2 text-sm font-semibold">Employee Pay Summary</p>
              <dl className="space-y-1 text-[12px]">
                <div><span>Employee Name : </span><span>{v.employeeName}</span></div>
                <div><span>Designation : </span><span>{v.designation}</span></div>
                <div><span>Date of Joining : </span><span>{v.dateOfJoining}</span></div>
                <div><span>Pay Method : </span><span>{v.payMethod}</span></div>
                <div><span>A/c No. : </span><span>{v.accountNumber}</span></div>
              </dl>
            </td>
            <td colSpan={2} className="border border-black px-3 py-4 text-center align-middle">
              <p className="text-sm font-semibold">Employee Cost To Company</p>
              <p className="mt-2 text-2xl font-bold tabular-nums">
                {Number(v.ctc || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
              <p className="mt-2 text-[12px]">
                Paid Days: {v.paidDays} | LOP Days: {v.lopDays}
              </p>
            </td>
          </tr>
          <tr>
            <Cell bold>EARNINGS</Cell>
            <Cell bold align="right">AMOUNT</Cell>
            <Cell bold>DEDUCTIONS</Cell>
            <Cell bold align="right">AMOUNT</Cell>
          </tr>
          {v.split.left.map((row, i) => (
            <tr key={`ed-${i}`}>
              <Cell>{row.label}</Cell>
              <Cell align="right">{row.amount}</Cell>
              <Cell>{v.split.right[i]?.label}</Cell>
              <Cell align="right">{v.split.right[i]?.amount}</Cell>
            </tr>
          ))}
          <tr>
            <Cell bold>Gross Earnings</Cell>
            <Cell bold align="right">{money(v.gross)}</Cell>
            <Cell bold>Total Deductions</Cell>
            <Cell bold align="right">{money(v.totalDed)}</Cell>
          </tr>
          <tr>
            <td colSpan={4} className="border border-black py-1.5 text-center text-[12px] font-semibold">
              REIMBURSEMENTS
            </td>
          </tr>
          {v.reimbursements.map((r, i) => (
            <tr key={`reimb-${i}`}>
              <Cell>{r.name || `Reimbursement ${i + 1}`}</Cell>
              <Cell align="right">{money(r.amount || 0)}</Cell>
              <Cell align="right">{money(r.amount || 0)}</Cell>
              <Cell align="right">{money(r.amount || 0)}</Cell>
            </tr>
          ))}
          <tr>
            <Cell bold className="text-center" align="center">Total Reimbursements</Cell>
            <Cell />
            <Cell />
            <Cell bold align="right">{money(v.totalReimb)}</Cell>
          </tr>
          <tr>
            <td colSpan={3} className="border border-black py-1.5 text-center text-[12px] font-semibold">
              NETPAY
            </td>
            <Cell bold align="right">AMOUNT</Cell>
          </tr>
          <tr>
            <Cell>Gross Earnings</Cell>
            <Cell />
            <Cell />
            <Cell align="right">{money(v.gross)}</Cell>
          </tr>
          <tr>
            <Cell>Total Deductions</Cell>
            <Cell />
            <Cell />
            <Cell align="right">{v.totalDed ? money(v.totalDed) : ''}</Cell>
          </tr>
          <tr>
            <Cell>Total Reimbursements</Cell>
            <Cell />
            <Cell />
            <Cell align="right">{money(v.totalReimb)}</Cell>
          </tr>
          <tr>
            <td colSpan={3} className="border border-black py-1.5 text-center text-[12px] font-semibold">
              Total Net Payable
            </td>
            <Cell bold align="right">{money(v.netPay)}</Cell>
          </tr>
          <tr>
            <td colSpan={4} className="border border-black px-3 py-3 text-center">
              <p className="text-[12px] font-semibold">
                Total Net Payable {v.netPayLabel} ({v.netPayWords})
              </p>
              <p className="mt-2 text-[11px] font-semibold">
                ** Total Net Payable = Gross Earnings - Total Deductions + Total Reimbursements
              </p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
