import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useCart } from "../../context/CartContext";
import { useShopAuth } from "../../context/ShopAuthContext";
import { getShopAddresses, addShopAddress, shopCheckout } from "../../lib/shopApi";
import { rupee } from "../../Components/shop/ProductCard";

const EMPTY_ADDR = { label: "Home", fullName: "", phone: "", line1: "", line2: "", city: "", district: "", state: "", stateCode: "", pincode: "" };
const inputCls = "border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-stone-400 outline-none";

export default function ShopCheckout() {
  const { items, subtotal, count, clearCart } = useCart();
  const { consumer } = useShopAuth();
  const navigate = useNavigate();

  const [addresses, setAddresses] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_ADDR, fullName: consumer?.name || "", phone: consumer?.phone || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await getShopAddresses();
        const list = res.data || [];
        setAddresses(list);
        const def = list.find((a) => a.isDefault) || list[0];
        if (def) setSelectedId(def._id); else setShowForm(true);
      } catch {
        setShowForm(true);
      }
    })();
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const saveAddress = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const res = await addShopAddress(form);
      const list = res.data || [];
      setAddresses(list);
      const newest = list[list.length - 1];
      setSelectedId(newest?._id || "");
      setShowForm(false);
      setForm({ ...EMPTY_ADDR, fullName: consumer?.name || "", phone: consumer?.phone || "" });
    } catch (err) {
      setError(err?.response?.data?.message || "Could not save address");
    } finally {
      setBusy(false);
    }
  };

  const placeOrder = async () => {
    setError("");
    if (!selectedId) { setError("Please select or add a delivery address."); return; }
    setBusy(true);
    try {
      const res = await shopCheckout({
        items: items.map((i) => ({ listingId: i.listingId, qty: i.qty })),
        shippingAddressId: selectedId,
      });
      clearCart();
      navigate("/customer-shop/order-success", { replace: true, state: { orders: res.data } });
    } catch (err) {
      setError(err?.response?.data?.message || "Could not place order");
      setBusy(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <div className="bg-white border border-stone-200 rounded-3xl p-12 shadow-sm">
          <h1 className="text-xl font-bold text-stone-900">Your cart is empty</h1>
          <Link to="/customer-shop/products" className="inline-block mt-4 bg-[#EA2831] text-white px-6 py-2.5 rounded-lg font-semibold">Browse products</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-stone-900 mb-4">Checkout</h1>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Address */}
          <section className="bg-white rounded-2xl border border-stone-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-stone-900 flex items-center gap-2"><span className="material-symbols-outlined text-stone-400">location_on</span>Delivery address</h2>
              {!showForm && <button onClick={() => setShowForm(true)} className="text-sm text-[#EA2831] font-semibold">+ Add new</button>}
            </div>

            {addresses.length > 0 && !showForm && (
              <div className="space-y-2">
                {addresses.map((a) => (
                  <label key={a._id} className={`flex gap-3 p-3 rounded-xl border cursor-pointer ${selectedId === a._id ? "border-[#EA2831] bg-red-50/40" : "border-stone-200 hover:border-stone-300"}`}>
                    <input type="radio" name="addr" checked={selectedId === a._id} onChange={() => setSelectedId(a._id)} className="mt-1 accent-[#EA2831]" />
                    <div className="text-sm">
                      <p className="font-semibold text-stone-900">{a.fullName || consumer?.name} {a.label ? <span className="text-xs text-stone-400">({a.label})</span> : null}</p>
                      <p className="text-stone-600">{[a.line1, a.line2, a.city, a.district, a.state, a.pincode].filter(Boolean).join(", ")}</p>
                      {a.phone && <p className="text-stone-500">📞 {a.phone}</p>}
                    </div>
                  </label>
                ))}
              </div>
            )}

            {showForm && (
              <form onSubmit={saveAddress} className="grid sm:grid-cols-2 gap-3 mt-2">
                <input required value={form.fullName} onChange={set("fullName")} placeholder="Full name" className={inputCls} />
                <input required value={form.phone} onChange={set("phone")} placeholder="Phone" className={inputCls} />
                <input required value={form.line1} onChange={set("line1")} placeholder="Address line 1" className={`${inputCls} sm:col-span-2`} />
                <input value={form.line2} onChange={set("line2")} placeholder="Address line 2 (optional)" className={`${inputCls} sm:col-span-2`} />
                <input required value={form.city} onChange={set("city")} placeholder="City" className={inputCls} />
                <input value={form.district} onChange={set("district")} placeholder="District" className={inputCls} />
                <input value={form.state} onChange={set("state")} placeholder="State" className={inputCls} />
                <input required value={form.pincode} onChange={set("pincode")} placeholder="Pincode" className={inputCls} />
                <div className="sm:col-span-2 flex gap-2">
                  <button disabled={busy} className="px-5 py-2 rounded-lg bg-[#EA2831] text-white text-sm font-semibold disabled:opacity-60">Save address</button>
                  {addresses.length > 0 && <button type="button" onClick={() => setShowForm(false)} className="px-5 py-2 rounded-lg border border-stone-200 text-sm text-stone-700 hover:bg-stone-50">Cancel</button>}
                </div>
              </form>
            )}
          </section>

          {/* Payment */}
          <section className="bg-white rounded-2xl border border-stone-200 p-5">
            <h2 className="font-bold text-stone-900 mb-3 flex items-center gap-2"><span className="material-symbols-outlined text-stone-400">payments</span>Payment method</h2>
            <label className="flex gap-3 p-3 rounded-xl border border-[#EA2831] bg-red-50/40 cursor-pointer">
              <input type="radio" checked readOnly className="mt-1 accent-[#EA2831]" />
              <div className="text-sm">
                <p className="font-semibold text-stone-900">Cash on Delivery (COD)</p>
                <p className="text-stone-500">Pay in cash when your order is delivered.</p>
              </div>
            </label>
          </section>
        </div>

        {/* Summary */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-stone-200 p-5 sticky top-24">
            <h2 className="font-bold text-stone-900 mb-3">Order Summary</h2>
            <div className="space-y-2 max-h-48 overflow-auto mb-3">
              {items.map((i) => (
                <div key={i.listingId} className="flex justify-between text-sm text-stone-600">
                  <span className="truncate pr-2">{i.name} × {i.qty}</span>
                  <span className="shrink-0">{rupee(i.price * i.qty)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-stone-100 pt-3 flex justify-between text-sm text-stone-600">
              <span>Subtotal ({count})</span><span>{rupee(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-stone-600"><span>Delivery</span><span className="text-emerald-700 font-medium">Free</span></div>
            <p className="text-xs text-stone-400 mt-1">Inclusive of all taxes · GST shown on seller invoice.</p>
            <div className="border-t border-stone-100 mt-3 pt-3 flex justify-between font-bold text-stone-900">
              <span>Total</span><span>{rupee(subtotal)}</span>
            </div>

            {error && <div className="mt-3 text-sm text-[#EA2831] bg-red-50 rounded-lg px-3 py-2">{error}</div>}

            <button onClick={placeOrder} disabled={busy} className="mt-4 w-full py-3 rounded-lg bg-[#EA2831] text-white font-semibold hover:bg-[#d21f27] disabled:opacity-60">
              {busy ? "Placing order…" : "Place Order (COD)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
