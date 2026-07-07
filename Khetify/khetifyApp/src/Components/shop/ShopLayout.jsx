import React, { useState } from "react";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useCart } from "../../context/CartContext";
import { useShopAuth } from "../../context/ShopAuthContext";

// Shared chrome for the customer storefront. Matches the Khetify app design
// language: clean white surfaces, stone palette, #EA2831 used only as an accent,
// font-sora + material-symbols icons. Self-contained — does not touch the
// company/seller/admin layouts.
export default function ShopLayout() {
  const { count } = useCart();
  const { isAuthed, consumer, logout } = useShopAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const submitSearch = (e) => {
    e.preventDefault();
    navigate(`/customer-shop/products?search=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-stone-50/50 font-sora text-stone-900">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/customer-shop" className="flex items-center gap-2 shrink-0">
            <span className="material-symbols-outlined text-[#EA2831] text-2xl">storefront</span>
            <span className="font-bold text-lg tracking-tight text-stone-900">Khetify <span className="text-stone-400 font-semibold">Bazaar</span></span>
          </Link>

          <form onSubmit={submitSearch} className="flex-1 max-w-2xl mx-auto">
            <div className="flex items-center rounded-xl border border-stone-200 bg-stone-50/50 focus-within:border-stone-300 overflow-hidden">
              <span className="material-symbols-outlined text-stone-400 text-xl pl-3">search</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search products, brands, sellers…"
                className="flex-1 px-3 py-2 bg-transparent text-stone-800 outline-none text-sm"
              />
              <button type="submit" className="px-4 py-2 bg-stone-900 text-white font-semibold text-sm hover:bg-stone-700 transition-colors">
                Search
              </button>
            </div>
          </form>

          <div className="flex items-center gap-2 shrink-0">
            {/* Account */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 text-sm font-semibold text-stone-600 hover:text-stone-900 px-2 py-1.5 rounded-lg hover:bg-stone-50"
              >
                <span className="material-symbols-outlined text-xl">account_circle</span>
                <span className="hidden sm:inline">{isAuthed ? consumer?.name?.split(" ")[0] || "Account" : "Login"}</span>
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-48 bg-white border border-stone-200 text-stone-700 rounded-2xl shadow-xl py-1 text-sm z-40 overflow-hidden">
                    {isAuthed ? (
                      <>
                        <div className="px-4 py-2 border-b border-stone-100">
                          <p className="text-xs text-stone-400">Signed in as</p>
                          <p className="font-semibold text-stone-800 truncate">{consumer?.name}</p>
                        </div>
                        <Link to="/customer-shop/orders" className="flex items-center gap-2 px-4 py-2 hover:bg-stone-50" onClick={() => setMenuOpen(false)}>
                          <span className="material-symbols-outlined text-lg text-stone-400">receipt_long</span> My Orders
                        </Link>
                        <button
                          onClick={() => { logout(); setMenuOpen(false); navigate("/customer-shop"); }}
                          className="flex items-center gap-2 w-full text-left px-4 py-2 hover:bg-stone-50 text-[#EA2831]"
                        >
                          <span className="material-symbols-outlined text-lg">logout</span> Logout
                        </button>
                      </>
                    ) : (
                      <>
                        <Link to={`/customer-shop/login?redirect=${encodeURIComponent(location.pathname)}`} className="block px-4 py-2 hover:bg-stone-50" onClick={() => setMenuOpen(false)}>Login</Link>
                        <Link to="/customer-shop/login?mode=register" className="block px-4 py-2 hover:bg-stone-50" onClick={() => setMenuOpen(false)}>Create account</Link>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Cart */}
            <Link to="/customer-shop/cart" className="relative flex items-center gap-1.5 text-sm font-semibold text-stone-600 hover:text-stone-900 px-2 py-1.5 rounded-lg hover:bg-stone-50">
              <span className="material-symbols-outlined text-xl">shopping_cart</span>
              <span className="hidden sm:inline">Cart</span>
              {count > 0 && (
                <span className="absolute -top-0.5 left-4 bg-[#EA2831] text-white text-[10px] font-bold rounded-full h-4 min-w-[16px] px-1 flex items-center justify-center border border-white">
                  {count}
                </span>
              )}
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full">
        <Outlet />
      </main>

      <footer className="bg-white border-t border-stone-200 text-stone-500 text-sm">
        <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} Khetify — agri-products marketplace.</span>
          <Link to="/customer-shop" className="hover:text-stone-800 font-medium">Back to store</Link>
        </div>
      </footer>
    </div>
  );
}
