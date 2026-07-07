import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getShopProducts } from "../../lib/shopApi";
import ProductCard from "../../Components/shop/ProductCard";

export default function ShopProducts() {
  const [params, setParams] = useSearchParams();
  const search = params.get("search") || "";
  const category = params.get("category") || "";
  const sort = params.get("sort") || "newest";
  const inStockOnly = params.get("inStockOnly") === "true";

  const [state, setState] = useState({ items: [], total: 0, categories: [], loading: true, error: "" });

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const res = await getShopProducts({ search, category, sort, inStockOnly, limit: 48 });
        if (!alive) return;
        setState({ items: res.data || [], total: res.total || 0, categories: res.categories || [], loading: false, error: "" });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, loading: false, error: e?.response?.data?.message || "Could not load products" }));
      }
    })();
    return () => { alive = false; };
  }, [search, category, sort, inStockOnly]);

  const update = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-stone-900">
            {search ? `Results for “${search}”` : category ? category : "All products"}
          </h1>
          <p className="text-sm text-stone-500">{state.total} item{state.total === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-stone-600 bg-white border border-stone-200 rounded-lg px-3 py-2 cursor-pointer">
            <input type="checkbox" checked={inStockOnly} onChange={(e) => update("inStockOnly", e.target.checked ? "true" : "")} className="accent-[#EA2831]" />
            In stock only
          </label>
          <select
            value={sort}
            onChange={(e) => update("sort", e.target.value)}
            className="border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white text-stone-700"
          >
            <option value="newest">Newest</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
            <option value="name_asc">Name: A–Z</option>
          </select>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Category rail */}
        {state.categories.length > 0 && (
          <aside className="hidden lg:block w-48 shrink-0">
            <div className="bg-white border border-stone-200 rounded-2xl p-4 sticky top-24">
              <h3 className="font-bold text-stone-800 text-sm mb-2">Categories</h3>
              <ul className="space-y-1 text-sm">
                <li>
                  <button onClick={() => update("category", "")} className={`hover:text-[#EA2831] ${!category ? "text-[#EA2831] font-semibold" : "text-stone-600"}`}>All</button>
                </li>
                {state.categories.map((c) => (
                  <li key={c}>
                    <button onClick={() => update("category", c)} className={`hover:text-[#EA2831] text-left ${category === c ? "text-[#EA2831] font-semibold" : "text-stone-600"}`}>{c}</button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}

        <div className="flex-1">
          {state.loading ? (
            <div className="py-20 text-center text-stone-400">Loading…</div>
          ) : state.error ? (
            <div className="py-20 text-center text-[#EA2831]">{state.error}</div>
          ) : state.items.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-3xl p-12 text-center shadow-sm">
              <span className="material-symbols-outlined text-stone-300 text-5xl font-light">search_off</span>
              <h3 className="text-lg font-bold text-stone-800 mt-3">No products found</h3>
              <p className="text-sm text-stone-500 mt-1">Try a different search or category.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {state.items.map((p) => <ProductCard key={p.listingId} product={p} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
