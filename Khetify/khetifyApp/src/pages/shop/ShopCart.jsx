import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "../../context/CartContext";
import { getProductImage } from "../../lib/productImage";
import { rupee } from "../../Components/shop/ProductCard";

export default function ShopCart() {
  const { items, setQty, removeItem, subtotal, count } = useCart();
  const navigate = useNavigate();

  if (items.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <div className="bg-white border border-stone-200 rounded-3xl p-12 shadow-sm">
          <span className="material-symbols-outlined text-stone-300 text-6xl font-light">shopping_cart</span>
          <h1 className="text-xl font-bold text-stone-900 mt-3">Your cart is empty</h1>
          <p className="text-stone-500 mt-1 text-sm">Add some products to get started.</p>
          <Link to="/customer-shop/products" className="inline-block mt-5 bg-[#EA2831] text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-[#d21f27]">
            Browse products
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-stone-900 mb-4">My Cart ({count})</h1>
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Lines */}
        <div className="lg:col-span-2 space-y-3">
          {items.map((it) => {
            const img = getProductImage(it.image);
            return (
              <div key={it.listingId} className="flex gap-4 bg-white rounded-2xl border border-stone-200 p-3">
                <Link to={`/customer-shop/product/${it.listingId}`} className="w-24 h-24 bg-stone-50 rounded-xl border border-stone-100 flex items-center justify-center overflow-hidden shrink-0">
                  {img ? <img src={img} alt={it.name} className="w-full h-full object-contain" /> : <span className="material-symbols-outlined text-stone-300 text-3xl font-light">inventory_2</span>}
                </Link>
                <div className="flex-1 min-w-0">
                  <Link to={`/customer-shop/product/${it.listingId}`} className="font-semibold text-stone-900 hover:text-[#EA2831] line-clamp-2">{it.name}</Link>
                  {it.sellerName && <p className="text-xs text-stone-400">by {it.sellerName}</p>}
                  <p className="text-lg font-bold text-stone-900 mt-1">{rupee(it.price)}</p>
                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex items-center border border-stone-200 rounded-lg">
                      <button onClick={() => setQty(it.listingId, it.qty - 1)} className="px-3 py-1 text-stone-600 hover:bg-stone-50">−</button>
                      <span className="px-3 text-sm">{it.qty}</span>
                      <button onClick={() => setQty(it.listingId, it.qty + 1)} className="px-3 py-1 text-stone-600 hover:bg-stone-50">+</button>
                    </div>
                    <button onClick={() => removeItem(it.listingId)} className="flex items-center gap-1 text-sm text-stone-400 hover:text-[#EA2831]">
                      <span className="material-symbols-outlined text-base">delete</span> Remove
                    </button>
                  </div>
                </div>
                <div className="text-right font-bold text-stone-900 shrink-0">{rupee(it.price * it.qty)}</div>
              </div>
            );
          })}
        </div>

        {/* Summary */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-stone-200 p-5 sticky top-24">
            <h2 className="font-bold text-stone-900 mb-3">Order Summary</h2>
            <div className="flex justify-between text-sm text-stone-600 mb-2">
              <span>Subtotal ({count} items)</span>
              <span>{rupee(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-stone-600 mb-2">
              <span>Delivery</span>
              <span className="text-emerald-700 font-medium">Free</span>
            </div>
            <p className="text-xs text-stone-400 mb-3">GST is calculated at checkout.</p>
            <div className="border-t border-stone-100 pt-3 flex justify-between font-bold text-stone-900">
              <span>Total</span>
              <span>{rupee(subtotal)}</span>
            </div>
            <button
              onClick={() => navigate("/customer-shop/checkout")}
              className="mt-4 w-full py-3 rounded-lg bg-[#EA2831] text-white font-semibold hover:bg-[#d21f27]"
            >
              Proceed to Checkout
            </button>
            <Link to="/customer-shop/products" className="block text-center mt-3 text-sm text-stone-500 hover:text-stone-800">Continue shopping</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
