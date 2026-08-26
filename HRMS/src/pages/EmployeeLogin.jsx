import PortalLogin from './PortalLogin';

/** Employee portal login — subdomain-per-tenant login surface, posts to
 *  /auth/employee/login. The backend also accepts the 'manager' role here;
 *  manager is not a separate portal. */
export default function EmployeeLogin() {
  return (
    <PortalLogin
      portal="employee"
      portalLabel="Employee Portal"
      placeholderEmail="e.g. you@company.com"
    />
  );
}
