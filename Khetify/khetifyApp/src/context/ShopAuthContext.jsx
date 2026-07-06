import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  getShopToken, setShopToken, clearShopToken,
  shopLogin, shopRegister, shopMe,
} from "../lib/shopApi";

// Storefront consumer auth. Kept fully separate from the company/seller auth so
// a shopper session never collides with an admin/seller session in the same
// browser (distinct localStorage keys: "shopToken" vs "token"/seller token).
const ShopAuthContext = createContext(null);

export function ShopAuthProvider({ children }) {
  const [consumer, setConsumer] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount, if a token exists, resolve the current consumer.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!getShopToken()) { setLoading(false); return; }
      try {
        const res = await shopMe();
        if (alive) setConsumer(res.data);
      } catch {
        clearShopToken();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const login = useCallback(async (identifier, password) => {
    const res = await shopLogin({ identifier, password });
    setShopToken(res.token);
    setConsumer(res.consumer);
    return res;
  }, []);

  const register = useCallback(async (body) => {
    const res = await shopRegister(body);
    setShopToken(res.token);
    setConsumer(res.consumer);
    return res;
  }, []);

  const logout = useCallback(() => {
    clearShopToken();
    setConsumer(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await shopMe();
      setConsumer(res.data);
      return res.data;
    } catch { return null; }
  }, []);

  return (
    <ShopAuthContext.Provider value={{ consumer, loading, isAuthed: !!consumer, login, register, logout, refresh }}>
      {children}
    </ShopAuthContext.Provider>
  );
}

export function useShopAuth() {
  const ctx = useContext(ShopAuthContext);
  if (!ctx) throw new Error("useShopAuth must be used within ShopAuthProvider");
  return ctx;
}
