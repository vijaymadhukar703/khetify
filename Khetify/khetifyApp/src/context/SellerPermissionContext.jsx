import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getSellerMe, isSellerAuthed } from "../lib/sellerApi";
import { resolveCapability } from "../lib/capabilities";

const SellerPermissionContext = createContext(null);

/**
 * Seller-side RBAC — mirrors PermissionContext but reads the seller member's
 * role + capabilities from the seller /me endpoint (sellerToken). Reuses the
 * SAME resolver as the company side (lib/capabilities.js).
 */
const EMPTY = { role: null, capabilities: [], deniedCapabilities: [], warehouseIds: [] };

export const SellerPermissionProvider = ({ children }) => {
  // Lazy init: only "loading" if there's a seller session to load — so the
  // no-session case needs no synchronous setState inside the effect.
  const [state, setState] = useState(() => ({ ...EMPTY, loading: isSellerAuthed() }));

  const apply = (d) => (d
    ? { role: d.role || "seller_admin", capabilities: d.capabilities || [], deniedCapabilities: d.deniedCapabilities || [], warehouseIds: (d.warehouseIds || []).map(String), loading: false }
    : { ...EMPTY, loading: false });

  // Load on mount — setState only inside the inline async .then/.catch.
  useEffect(() => {
    if (!isSellerAuthed()) return undefined;
    let cancelled = false;
    getSellerMe()
      .then((r) => { if (!cancelled) setState(apply(r?.data)); })
      .catch((err) => { if (!cancelled) { console.error("Seller permission load failed:", err?.response?.data || err.message); setState({ ...EMPTY, loading: false }); } });
    return () => { cancelled = true; };
  }, []);

  // Manual refresh for consumers (safe to setState — not called from an effect).
  const refresh = useCallback(() => {
    if (!isSellerAuthed()) return;
    getSellerMe().then((r) => setState(apply(r?.data))).catch(() => setState({ ...EMPTY, loading: false }));
  }, []);

  const sellerCan = useCallback(
    (capability) => resolveCapability(state.role, state.capabilities, state.deniedCapabilities, capability),
    [state.role, state.capabilities, state.deniedCapabilities]
  );

  return (
    <SellerPermissionContext.Provider value={{ ...state, sellerCan, refresh }}>
      {children}
    </SellerPermissionContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSellerPermission = (capability) => {
  const ctx = useContext(SellerPermissionContext);
  if (!ctx) throw new Error("useSellerPermission must be used inside <SellerPermissionProvider>");
  if (capability !== undefined) return !ctx.loading && ctx.sellerCan(capability);
  return ctx;
};
