import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useShopAuth } from "../../context/ShopAuthContext";

// Gate for storefront routes that need a logged-in shopper (checkout, orders).
// Unauthed shoppers are bounced to the shop login with a redirect back.
export default function RequireConsumer({ children }) {
  const { isAuthed, loading } = useShopAuth();
  const location = useLocation();

  if (loading) {
    return <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Loading…</div>;
  }
  if (!isAuthed) {
    return <Navigate to={`/customer-shop/login?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return children;
}
