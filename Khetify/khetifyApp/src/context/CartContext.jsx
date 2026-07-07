import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";

// Guest cart — lives in localStorage so a shopper can browse and add to cart
// WITHOUT logging in. Login is only required at checkout. Each cart line stores
// a snapshot (name/price/image/seller) for display + the listingId/qty that the
// server re-prices at checkout (client prices are never trusted).
const CART_KEY = "shopCart";
const CartContext = createContext(null);

function readCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(readCart);

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  }, [items]);

  // Sync across tabs.
  useEffect(() => {
    const onStorage = (e) => { if (e.key === CART_KEY) setItems(readCart()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Add `addQty` units of a product to the cart. Default is 1 — one click adds
  // exactly one unit. If the line already exists, the quantity is INCREMENTED by
  // addQty (not replaced). Never exceeds the product's available stock, and
  // never uses minimumOrderQuantity/stock as the added amount.
  const addItem = useCallback((product, addQty = 1) => {
    // Sanitise: a positive integer, at least 1.
    const inc = Math.max(1, Math.floor(Number(addQty) || 1));
    const max = Number.isFinite(product.availableStock) && product.availableStock > 0
      ? product.availableStock
      : Infinity;

    setItems((prev) => {
      const idx = prev.findIndex((i) => i.listingId === product.listingId);
      if (idx >= 0) {
        const next = [...prev];
        const cap = Number.isFinite(next[idx].availableStock) && next[idx].availableStock > 0
          ? next[idx].availableStock
          : max;
        next[idx] = { ...next[idx], qty: Math.min(next[idx].qty + inc, cap) };
        return next;
      }
      return [...prev, {
        listingId: product.listingId,
        productId: product.productId,
        sellerId: product.sellerId,
        name: product.name,
        price: product.price,
        image: product.images?.[0] || null,
        unit: product.unit,
        sellerName: product.seller?.name,
        availableStock: Number.isFinite(product.availableStock) ? product.availableStock : null,
        qty: Math.min(inc, max),
      }];
    });
  }, []);

  // Set an exact quantity for a line (from the cart's +/- steppers). Clamped to
  // [1, availableStock]; 0 or less removes the line.
  const setQty = useCallback((listingId, qty) => {
    setItems((prev) =>
      prev.flatMap((i) => {
        if (i.listingId !== listingId) return [i];
        const cap = Number.isFinite(i.availableStock) && i.availableStock > 0 ? i.availableStock : Infinity;
        const n = Math.min(Math.max(0, Math.floor(Number(qty) || 0)), cap);
        return n <= 0 ? [] : [{ ...i, qty: n }];
      })
    );
  }, []);

  const removeItem = useCallback((listingId) => {
    setItems((prev) => prev.filter((i) => i.listingId !== listingId));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const { count, subtotal } = useMemo(() => ({
    count: items.reduce((s, i) => s + i.qty, 0),
    subtotal: items.reduce((s, i) => s + i.qty * (i.price || 0), 0),
  }), [items]);

  return (
    <CartContext.Provider value={{ items, addItem, setQty, removeItem, clearCart, count, subtotal }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
