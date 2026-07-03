import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMyListings } from '../../lib/sellerApi';

// Where the customer storefront lives — used to "view on storefront".
const STOREFRONT_URL = (import.meta.env.VITE_CUSTOMER_STOREFRONT_URL || 'http://localhost:5174').replace(/\/$/, '');

const fmtDate = (d) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return '—'; }
};

const StatusPill = ({ status }) => {
  const published = status === 'published';
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap border ${
      published ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-stone-100 text-stone-500 border-stone-200'
    }`}>
      {published ? 'Published' : 'Unpublished'}
    </span>
  );
};

const SellerListings = () => {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchListings = useCallback(() => {
    getMyListings()
      .then((r) => { if (r?.success) setListings(r.data || []); })
      .catch(() => setListings([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { fetchListings(); }, [fetchListings]);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50/50 font-sora">
      <div className="max-w-7xl mx-auto space-y-6 text-left">
        <div>
          <h1 className="text-xl font-bold text-stone-900">Marketplace listings</h1>
          <p className="text-sm text-stone-500">Products you've published on the Khetify storefront.</p>
        </div>

        {!loading && listings.length === 0 ? (
          <div className="max-w-xl mx-auto mt-10 bg-white border border-stone-200 rounded-3xl p-10 text-center shadow-sm">
            <span className="material-symbols-outlined text-stone-300 text-5xl font-light">storefront</span>
            <h2 className="text-lg font-bold text-stone-800 mt-3">No listings yet</h2>
            <p className="text-sm text-stone-500 mt-1">Publish products from your catalog to sell them on the storefront.</p>
            <Link
              to="/seller/products"
              className="inline-block mt-5 bg-stone-900 text-white hover:bg-stone-700 text-xs font-semibold px-4 py-2.5 rounded-md"
            >
              Browse your catalog to publish products
            </Link>
          </div>
        ) : (
          <div className="border border-stone-200 rounded-3xl overflow-hidden shadow-sm bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[760px] resp-table">
                <thead>
                  <tr className="bg-stone-50/50 border-b border-stone-200">
                    <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Product</th>
                    <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Price (₹)</th>
                    <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Status</th>
                    <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Published</th>
                    <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {!loading && listings.map((l) => {
                    const product = l.productId && typeof l.productId === 'object' ? l.productId : null;
                    const productId = String(product?._id || l.productId);
                    return (
                      <tr key={l._id} className="hover:bg-stone-50/30 transition-colors">
                        <td data-label="Product" className="px-6 py-4">
                          <div className="flex items-center gap-4">
                            <div className="size-12 min-w-[48px] rounded-xl bg-stone-100 border border-stone-200 overflow-hidden flex items-center justify-center">
                              <span className="material-symbols-outlined text-2xl text-stone-300 font-light">inventory_2</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="font-bold text-stone-900 text-sm">{product?.productName || 'Product'}</span>
                              <span className="text-[10px] text-stone-400 font-medium font-mono uppercase tracking-tighter">{product?.skuNumber || '---'}</span>
                            </div>
                          </div>
                        </td>
                        <td data-label="Price (₹)" className="px-6 py-4 text-sm text-stone-900 font-black">₹{l.price ?? '—'}</td>
                        <td data-label="Status" className="px-6 py-4"><StatusPill status={l.status} /></td>
                        <td data-label="Published" className="px-6 py-4 text-xs text-stone-500 font-semibold">{fmtDate(l.publishedAt)}</td>
                        <td className="px-6 py-4 text-right cell-actions">
                          <a
                            href={`${STOREFRONT_URL}/products/${productId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
                          >
                            View on storefront
                            <span className="material-symbols-outlined text-sm">open_in_new</span>
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                  {loading && (
                    <tr><td colSpan={5} className="px-6 py-12 text-center text-sm text-stone-400">Loading…</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SellerListings;
