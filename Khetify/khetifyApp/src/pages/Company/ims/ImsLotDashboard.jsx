import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSubscription } from '../../../context/SubscriptionContext';
import {
  getLots, getWarehouses, formatINR, daysToExpiry, expiryBadge, fmtDate,
} from '../../../lib/imsApi';
import { StatCard } from './ImsUi';
import { usePermission } from '../../../context/PermissionContext';

/**
 * IMS Lot Dashboard — lot-level visibility, exactly the columns the
 * workflow requires: Company, Product, Type → Category, Brand,
 * Packing size, Lot number, Qty, MRP (+ expiry status).
 * Rows are FEFO-sorted: the lot that must sell first is on top.
 */
const ImsLotDashboard = () => {
  const navigate = useNavigate();
  const { plan, loading: subLoading } = useSubscription();
  const isSubscribed = !!plan && plan !== 'free';

  useEffect(() => {
    if (!subLoading && !isSubscribed) navigate('/billing', { replace: true });
  }, [subLoading, isSubscribed, navigate]);

  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Warehouse-level access: same data the admin sees, filtered to the
  // manager's assigned warehouse(s). The banner makes the slice explicit.
  const { warehouseIds } = usePermission();
  const [scopeNames, setScopeNames] = useState([]);
  useEffect(() => {
    if (!warehouseIds?.length) { setScopeNames([]); return; }
    getWarehouses()
      .then((r) => setScopeNames((Array.isArray(r) ? r : r?.data || []).map((w) => w.name)))
      .catch(() => {});
  }, [warehouseIds]);

  useEffect(() => {
    getLots()
      .then((res) => res?.success && setLots(res.data))
      .catch((err) => console.error('Lots fetch failed:', err?.response?.data || err.message))
      .finally(() => setLoading(false));
  }, []);

  const live = useMemo(() => lots.filter((l) => l.availableStock > 0), [lots]);

  const expiring = live.filter((l) => {
    const d = daysToExpiry(l.expiryDate);
    return d !== null && d >= 0 && d <= 90;
  });
  const expired = live.filter((l) => daysToExpiry(l.expiryDate) < 0);
  const totalUnits = live.reduce((s, l) => s + l.availableStock, 0);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return live.filter((l) => {
      const p = l.productId || {};
      return (
        (p.productName || '').toLowerCase().includes(q) ||
        (l.lotNumber || '').toLowerCase().includes(q) ||
        (l.batchNumber || '').toLowerCase().includes(q) ||
        (p.brandName || '').toLowerCase().includes(q)
      );
    });
  }, [live, search]);

  if (subLoading || !isSubscribed) return null;

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">

        {scopeNames.length > 0 && (
          <p className="text-[11px] font-bold text-stone-500 -mb-2 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm text-[#EA2831]">warehouse</span>
            Showing stock for your warehouse: <span className="text-stone-900">{scopeNames.join(', ')}</span>
          </p>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <StatCard label="Live Lots" value={live.length} />
          <StatCard label="Units in Stock" value={totalUnits.toLocaleString('en-IN')} />
          <StatCard label="Expiring ≤ 90 Days" value={expiring.length} accent="text-orange-500" />
          <StatCard label="Expired Lots" value={expired.length} accent="text-red-600" />
        </div>

        {/* Expiry alert banner — same pattern as the inventory low-stock banner */}
        {(expired.length > 0 || expiring.length > 0) && (
          <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-xl p-4">
            <span className="material-symbols-outlined text-orange-500">event_busy</span>
            <div>
              <p className="font-bold text-stone-900 text-sm">
                {expired.length > 0 && `${expired.length} expired lot(s) still in stock. `}
                {expiring.length > 0 && `${expiring.length} lot(s) expire within 90 days.`}
              </p>
              <p className="text-xs text-stone-500">
                FEFO is enforced on sales — expired lots are never picked. Write them off from Lots &amp; Batches.
              </p>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-stone-50/50 p-4 rounded-xl border border-stone-100">
          <div className="relative w-full md:flex-1 md:max-w-md">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">search</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product, brand or lot number..."
              className="pl-10 w-full border border-stone-200 rounded-lg py-2.5 text-sm focus:ring-[#EA2831] bg-white"
            />
          </div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
            Sorted by expiry — first row sells first (FEFO)
          </p>
        </div>

        {/* THE visibility table */}
        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[1100px] resp-table">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200">
                  {['Company', 'Product', 'Type / Category', 'Brand', 'Packing Size', 'Lot No.', 'Qty', 'MRP', 'Expiry', 'Status'].map((h) => (
                    <th key={h} className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filtered.map((lot) => {
                  const p = lot.productId || {};
                  const badge = expiryBadge(lot.expiryDate);
                  return (
                    <tr key={lot._id} className="hover:bg-stone-50/30 transition-colors">
                      <td data-label="Company" className="px-6 py-5 text-sm text-stone-500 font-medium">
                        {p.companyId?.companyName || '—'}
                      </td>
                      <td data-label="Product" className="px-6 py-5">
                        <p className="font-bold text-stone-900 text-sm">{p.productName || '—'}</p>
                        <p className="text-[10px] font-bold text-stone-400 uppercase tracking-tight">SKU: {p.skuNumber || '—'}</p>
                      </td>
                      <td data-label="Type / Category" className="px-6 py-5 text-sm text-stone-500 font-medium">
                        {p.category || '—'}
                        {p.unitType ? <span className="text-stone-400"> → {p.unitType}</span> : null}
                      </td>
                      <td data-label="Brand" className="px-6 py-5 text-sm text-stone-500 font-medium">{p.brandName || '—'}</td>
                      <td data-label="Packing Size" className="px-6 py-5 text-sm text-stone-500 font-medium">
                        {p.packagingType || '—'}{p.unit ? ` · ${p.unit}` : ''}
                      </td>
                      <td data-label="Lot No." className="px-6 py-5">
                        <span className="text-xs font-bold bg-stone-100 text-stone-600 px-2.5 py-1 rounded-full">
                          {lot.lotNumber || lot.batchNumber}
                        </span>
                      </td>
                      <td data-label="Qty" className="px-6 py-5 text-sm text-stone-900 font-bold">
                        {lot.availableStock.toLocaleString('en-IN')}
                        {lot.reservedStock > 0 && (
                          <span className="text-[10px] text-stone-400 font-medium block">+{lot.reservedStock} reserved</span>
                        )}
                      </td>
                      <td data-label="MRP" className="px-6 py-5 text-sm text-stone-900 font-bold">{formatINR(p.mrp)}</td>
                      <td data-label="Expiry" className="px-6 py-5 text-sm text-stone-500 font-medium">{fmtDate(lot.expiryDate)}</td>
                      <td data-label="Status" className="px-6 py-5">
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badge.cls}`}>{badge.label}</span>
                      </td>
                    </tr>
                  );
                })}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center text-sm text-stone-400">
                      No lots in stock yet — receive your first lot from the Lots &amp; Batches page.
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr><td colSpan={10} className="px-6 py-12 text-center text-sm text-stone-400">Loading lots…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImsLotDashboard;
