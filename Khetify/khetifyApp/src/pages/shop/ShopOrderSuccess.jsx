import React from "react";
import { Link, useLocation } from "react-router-dom";
import { rupee } from "../../Components/shop/ProductCard";

export default function ShopOrderSuccess() {
  const { state } = useLocation();
  const orders = state?.orders || [];

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="bg-white border border-stone-200 rounded-3xl p-8 text-center shadow-sm">
        <span className="material-symbols-outlined text-emerald-500 text-6xl">check_circle</span>
        <h1 className="text-2xl font-bold text-stone-900 mt-2">Order placed!</h1>
        <p className="text-stone-500 mt-2 text-sm">
          Thank you for your order. {orders.length > 1 ? `It was split into ${orders.length} shipments (one per seller).` : ""} You'll pay by cash on delivery.
        </p>

        {orders.length > 0 && (
          <div className="mt-6 text-left space-y-3">
            {orders.map((o) => (
              <div key={o._id} className="flex justify-between items-center border border-stone-100 rounded-xl px-4 py-3">
                <div>
                  <p className="font-semibold text-stone-900">{o.orderNumber}</p>
                  <p className="text-xs text-stone-500">{o.totalUnits} item(s) · status: {o.status}</p>
                </div>
                <span className="font-bold text-stone-900">{rupee(o.totalAmount || 0)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex gap-3 justify-center">
          <Link to="/customer-shop/orders" className="px-6 py-2.5 rounded-lg bg-[#EA2831] text-white font-semibold hover:bg-[#d21f27]">View my orders</Link>
          <Link to="/customer-shop/products" className="px-6 py-2.5 rounded-lg border border-stone-200 font-semibold text-stone-700 hover:bg-stone-50">Continue shopping</Link>
        </div>
      </div>
    </div>
  );
}
