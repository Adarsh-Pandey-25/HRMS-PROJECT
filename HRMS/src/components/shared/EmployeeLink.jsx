import { Link } from 'react-router-dom';
import { employeeProfilePath } from '../../lib/employeeRoutes';
import { cn } from '../../lib/utils';

/**
 * An employee's name (or avatar and name) that opens their profile when
 * clicked, on the tab that fits the page: attendance pages open Attendance,
 * leave pages open Leave, payroll pages open Payroll. Links by the
 * employee's id, which is unique across companies (employee codes restart
 * per company). With neither an id nor a code it is plain text.
 */
export function EmployeeLink({ employeeId, employeeCode, tab, query, className, children }) {
  const target = employeeId ? { id: employeeId } : (employeeCode ? { employeeCode } : null);
  if (!target) return <span className={className}>{children}</span>;
  return (
    <Link
      to={employeeProfilePath(target, undefined, { tab, ...query })}
      // A row that is clickable itself (an approval card, a table row) must not
      // act too — on a click, or on Enter (DataTable's row keys cancel it).
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn('hover:text-primary hover:underline underline-offset-2', className)}
    >
      {children}
    </Link>
  );
}
