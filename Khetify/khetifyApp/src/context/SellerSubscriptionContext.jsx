import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getSellerSubscription, isSellerAuthed } from "../lib/sellerApi";

const SellerSubscriptionContext = createContext(null);

// Seller subscription/plan gating — mirrors SubscriptionContext but reads
// /api/seller/subscription/me with the sellerToken. Drives premium module
// gating (Inventory / Labels / Analytics) in the seller portal.
export const SellerSubscriptionProvider = ({ children }) => {
  const [sub, setSub] = useState({ plan: "free", features: [], limits: {} });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isSellerAuthed()) {
      setSub({ plan: "free", features: [], limits: {} });
      setLoading(false);
      return;
    }
    try {
      const r = await getSellerSubscription();
      if (r?.success) setSub(r.data);
    } catch (err) {
      console.error("Seller subscription load failed:", err?.response?.data || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const sellerCan = useCallback(
    (feature) => !feature || (Array.isArray(sub.features) && sub.features.includes(feature)),
    [sub]
  );

  return (
    <SellerSubscriptionContext.Provider value={{ sellerPlan: sub.plan, features: sub.features, limits: sub.limits, loading, sellerCan, refresh }}>
      {children}
    </SellerSubscriptionContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSellerSubscription = () => {
  const ctx = useContext(SellerSubscriptionContext);
  if (!ctx) throw new Error("useSellerSubscription must be used inside <SellerSubscriptionProvider>");
  return ctx;
};
