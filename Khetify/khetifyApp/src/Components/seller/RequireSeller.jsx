import React from "react";
import { Navigate } from "react-router-dom";
import { isSellerAuthed } from "../../lib/sellerApi";

// Page-level guard for the seller portal: no seller token → bounce to login.
// Mirrors the company-side route protection but reads the seller token only.
const RequireSeller = ({ children }) => {
  if (!isSellerAuthed()) return <Navigate to="/seller/login" replace />;
  return children;
};

export default RequireSeller;
