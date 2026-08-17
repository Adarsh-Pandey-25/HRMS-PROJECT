import { Navigate } from 'react-router-dom';

/** Manage courses is now integrated into Course Catalog. */
export default function ManageCourses() {
  return <Navigate to="/training/catalog" replace />;
}
