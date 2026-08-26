import PortalLogin from './PortalLogin';

/** HR portal login — subdomain-per-tenant login surface, posts to /auth/hr/login. */
export default function HrLogin() {
  return (
    <PortalLogin
      portal="hr"
      portalLabel="HR Portal"
      placeholderEmail="e.g. hr@company.com"
    />
  );
}
