import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getShopOrders } from "../../lib/shopApi";
import { rupee } from "../../Components/shop/ProductCard";

const STEPS = ["pending", "confirmed", "packed", "shipped", "delivered"];
const STATUS_LABEL = {
  pending: "Order placed",
  confirmed: "Confirmed",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  returned: "Returned",
  cancelled: "Cancelled",
};

function Tracker({ status }) {
  if (status === "cancelled" || status === "returned") {
    return <span className="text-sm font-semibold text-[#EA2831]">{STATUS_LABEL[status]}</span>;
  }
  const active = STEPS.indexOf(status);
  return (
    <div className="flex items-center gap-1 mt-2">
      {STEPS.map((s, i) => (
        <React.Fragment key={s}>
          <div className={`h-2 w-2 rounded-full ${i <= active ? "bg-emerald-500" : "bg-stone-200"}`} title={STATUS_LABEL[s]} />
          {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 ${i < active ? "bg-emerald-500" : "bg-stone-200"}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function ShopOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await getShopOrders();
        setOrders(res.data || []);
      } catch (e) {
        setError(e?.response?.data?.message || "Could not load orders");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="py-20 text-center text-stone-400 font-sora">Loading your orders…</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-stone-900 mb-4">My Orders</h1>

      {error && <div className="text-[#EA2831] text-center py-10">{error}</div>}

      {!error && orders.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-3xl p-12 text-center shadow-sm">
          <span className="material-symbols-outlined text-stone-300 text-5xl font-light">receipt_long</span>
          <h3 className="text-lg font-bold text-stone-800 mt-3">No orders yet</h3>
          <p className="text-sm text-stone-500 mt-1">Your orders will appear here after you check out.</p>
          <Link to="/customer-shop/products" className="inline-block mt-5 text-[#EA2831] font-semibold hover:underline">Start shopping →</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((o) => (
            <div key={o._id} className="bg-white rounded-2xl border border-stone-200 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-stone-900">{o.orderNumber}</p>
                  <p className="text-xs text-stone-400">Placed {new Date(o.placedAt || o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-stone-900">{rupee(o.totalAmount || 0)}</p>
                  <p className="text-xs text-stone-400 uppercase">{o.payment?.mode || "cod"}</p>
                </div>
              </div>

              <div className="mt-3 space-y-1 border-t border-stone-100 pt-3">
                {(o.items || []).map((it, i) => (
                  <div key={i} className="flex justify-between text-sm text-stone-600">
                    <span className="truncate pr-2">{it.name} × {it.qty}</span>
                    <span className="shrink-0">{rupee(it.price * it.qty)}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3">
                <p className="text-sm font-semibold text-stone-700">{STATUS_LABEL[o.status] || o.status}</p>
                <Tracker status={o.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
