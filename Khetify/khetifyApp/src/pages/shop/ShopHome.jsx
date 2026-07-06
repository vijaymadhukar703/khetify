import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getShopProducts, getShopCategories } from "../../lib/shopApi";
import ProductCard from "../../Components/shop/ProductCard";

export default function ShopHome() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [prodRes, catRes] = await Promise.all([
          getShopProducts({ limit: 20, sort: "newest" }),
          getShopCategories(),
        ]);
        if (!alive) return;
        setProducts(prodRes.data || []);
        setCategories(catRes.data || []);
      } catch (e) {
        if (alive) setError(e?.response?.data?.message || "Could not load products");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-8">
      {/* Hero — clean white card with a red accent, matching the app */}
      <div className="rounded-3xl border border-stone-200 bg-white shadow-sm p-8 sm:p-10 flex flex-col sm:flex-row items-center gap-6">
        <div className="flex-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#EA2831] bg-red-50 px-3 py-1 rounded-full">
            <span className="material-symbols-outlined text-sm">verified</span> Verified sellers
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 mt-3">Fresh from farms & trusted sellers</h1>
          <p className="mt-2 text-stone-500 max-w-xl text-sm">Browse agri products published by verified Khetify sellers across India. No login needed to explore — sign in only when you check out.</p>
          <Link to="/customer-shop/products" className="inline-flex items-center gap-1.5 mt-5 bg-[#EA2831] text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-[#d21f27] transition-colors text-sm">
            Shop all products <span className="material-symbols-outlined text-lg">arrow_forward</span>
          </Link>
        </div>
        <div className="hidden sm:flex size-40 rounded-3xl bg-stone-50 border border-stone-200 items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[#EA2831] text-7xl font-light">agriculture</span>
        </div>
      </div>

      {/* Categories */}
      {categories.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-stone-900 mb-3">Shop by category</h2>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => navigate(`/customer-shop/products?category=${encodeURIComponent(c)}`)}
                className="px-4 py-2 rounded-xl bg-white border border-stone-200 text-sm font-medium text-stone-700 hover:border-[#EA2831] hover:text-[#EA2831] transition-colors"
              >
                {c}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Latest products */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-stone-900">Latest products</h2>
          <Link to="/customer-shop/products" className="text-sm text-[#EA2831] font-semibold hover:underline">View all →</Link>
        </div>

        {loading ? (
          <div className="py-20 text-center text-stone-400">Loading products…</div>
        ) : error ? (
          <div className="py-20 text-center text-[#EA2831]">{error}</div>
        ) : products.length === 0 ? (
          <div className="bg-white border border-stone-200 rounded-3xl p-12 text-center shadow-sm">
            <span className="material-symbols-outlined text-stone-300 text-5xl font-light">storefront</span>
            <h3 className="text-lg font-bold text-stone-800 mt-3">No products available right now</h3>
            <p className="text-sm text-stone-500 mt-1">Products appear here once sellers publish them on the marketplace.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {products.map((p) => <ProductCard key={p.listingId} product={p} />)}
          </div>
        )}
      </section>
    </div>
  );
}
