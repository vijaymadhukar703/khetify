import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getMe } from "../lib/imsApi";
import { resolveCapability as resolve } from "../lib/capabilities";

const PermissionContext = createContext(null);

export const PermissionProvider = ({ children }) => {
  const [state, setState] = useState({ role: null, capabilities: [], deniedCapabilities: [], warehouseIds: [], name: null, companyName: null, warehouses: [], loading: true });

  const refresh = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setState({ role: null, capabilities: [], deniedCapabilities: [], warehouseIds: [], name: null, companyName: null, warehouses: [], loading: false });
      return;
    }
    try {
      const res = await getMe();
      if (res?.success) {
        setState({
          role: res.data.role,
          capabilities: res.data.capabilities || [],
          // Capabilities explicitly denied despite a wildcard (e.g. admin's
          // inventory:transfer). Honored in resolve() before any grant check.
          deniedCapabilities: res.data.deniedCapabilities || [],
          // Warehouse-level access: the warehouses this user is assigned to
          // (empty = unscoped). Mirrors backend services/warehouseScope.js.
          warehouseIds: (res.data.warehouseIds || []).map(String),
          // Identity for the header profile: the person, their company's business
          // name, and the assigned warehouse(s) resolved to names. Live from the
          // API, so a rename or reassignment shows without re-login.
          name: res.data.name || null,
          companyName: res.data.companyName || null,
          warehouses: res.data.warehouses || [],
          loading: false,
        });
      } else {
        setState((s) => ({ ...s, loading: false }));
      }
    } catch (err) {
      console.error("Permission load failed:", err?.response?.data || err.message);
      setState({ role: null, capabilities: [], deniedCapabilities: [], warehouseIds: [], name: null, companyName: null, warehouses: [], loading: false });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const can = useCallback(
    (capability) => resolve(state.role, state.capabilities, state.deniedCapabilities, capability),
    [state.role, state.capabilities, state.deniedCapabilities]
  );

  return (
    <PermissionContext.Provider value={{ ...state, can, refresh }}>
      {children}
    </PermissionContext.Provider>
  );
};

/**
 * usePermission()            -> { can, role, capabilities, loading, refresh }
 * usePermission("grn:post")  -> boolean (convenience)
 *
 * While capabilities are still loading, the boolean form returns false to
 * avoid flashing controls the user may not have.
 */
export const usePermission = (capability) => {
  const ctx = useContext(PermissionContext);
  if (!ctx) throw new Error("usePermission must be used inside <PermissionProvider>");
  if (capability !== undefined) return !ctx.loading && ctx.can(capability);
  return ctx;
};
