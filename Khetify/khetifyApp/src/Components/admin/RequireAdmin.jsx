import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isAdminAuthed } from '../../lib/adminApi';

// Route guard for the platform admin panel. No admin token → bounce to the
// admin login (preserving the intended destination so we can return after auth).
const RequireAdmin = ({ children }) => {
  const location = useLocation();
  if (!isAdminAuthed()) {
    return <Navigate to="/admin/login" replace state={{ from: location }} />;
  }
  return children;
};

export default RequireAdmin;
