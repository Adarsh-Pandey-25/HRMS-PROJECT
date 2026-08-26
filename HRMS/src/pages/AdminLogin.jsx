import PortalLogin from './PortalLogin';

/** Admin portal login — subdomain-per-tenant login surface, posts to /auth/admin/login. */
export default function AdminLogin() {
  return (
    <PortalLogin
      portal="admin"
      portalLabel="Admin Portal"
      placeholderEmail="e.g. admin@company.com"
    />
  );
}
