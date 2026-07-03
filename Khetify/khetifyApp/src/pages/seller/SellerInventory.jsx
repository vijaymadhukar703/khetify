import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STATUS, statusOf, computeInventorySummary, formatINR } from '../../lib/inventoryData';
import { daysToExpiry, expiryBadge, fmtDate } from '../../lib/imsApi';
import { getSellerLink, getSellerLots } from '../../lib/sellerApi';

// Seller Inventory — READ-ONLY view of the seller's own stock (ownerType
// "seller"), mirroring the company Inventory tabs (Stock / Lots / Batches).
// Sellers receive lots via supply (Phase 3); they never create them, so there
// are no create/receive controls. Stock is valued at MRP (never cost).
const TABS = [
  { key: 'stock', label: 'Stock', icon: 'list_alt' },
  { key: 'lots', label: 'Lots', icon: 'package_2' },
  { key: 'batches', label: 'Batches', icon: 'monitoring' },
];

const SellerInventory = () => {
  const [approved, setApproved] = useState(null);
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('stock');

  const loadLots = useCallback(() => {
    getSellerLots()
      .then((r) => { if (r?.success) setLots(r.data || []); })
      .catch(() => setLots([]))
      .finally(() => setLoading(false));
  }, []);

  const load = useCallback(() => {
    getSellerLink()
      .then((r) => {
        const ok = r?.data?.linkStatus === 'approved';
        setApproved(ok);
        if (ok) loadLots(); else setLoading(false);
      })
      .catch(() => { setApproved(false); setLoading(false); });
  }, [loadLots]);
  useEffect(() => { load(); }, [load]);

  if (approved === null) return <div className="flex-1 p-8 text-center text-stone-400 font-sora">Loading…</div>;
  if (!approved) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">lock</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Inventory is locked</h2>
          <p className="text-sm text-amber-700 mt-1">Available after your supplying company approves you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 font-sora">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Inventory</h1>
      <p className="text-stone-500 mb-5">Your stock on hand, lots and expiry batches — received from your supplying company.</p>

      <div className="flex gap-1 border-b border-stone-200 mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t.key ? 'border-[#EA2831] text-[#EA2831]' : 'border-transparent text-stone-400 hover:text-stone-700'
            }`}>
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {tab === 'stock' && <StockTab lots={lots} loading={loading} />}
      {tab === 'lots' && <LotsTab lots={lots} loading={loading} />}
      {tab === 'batches' && <BatchesTab lots={lots} loading={loading} />}
    </div>
  );
};

/* ───────────── Stock (MRP-valued summary) ───────────── */
const StockTab = ({ lots, loading }) => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  const rows = useMemo(() => lots.map((l) => {
    const p = l.productId || {};
    return {
      id: l._id,
      name: p.productName || '—',
      category: p.category || 'Uncategorised',
      lotNo: l.lotNumber || l.batchNumber || '—',
      warehouse: l.warehouseId?.name || 'Unassigned',
      expiryDate: l.expiryDate || null,
      stock: l.availableStock || 0,
      reorderLevel: l.lowStockThreshold || 0,
      price: p.mrp || 0, // value at MRP only — never cost
    };
  }), [lots]);

  const summary = useMemo(() => computeInventorySummary(rows), [rows]);
  const categories = useMemo(() => ['All', ...Array.from(new Set(rows.map((r) => r.category)))], [rows]);
  const filtered = useMemo(() => rows.filter((item) => {
    const q = search.toLowerCase();
    const matchesSearch = item.name.toLowerCase().includes(q) || item.lotNo.toLowerCase().includes(q);
    const matchesCategory = category === 'All' || item.category === category;
    const matchesStatus = statusFilter === 'All' || statusOf(item) === statusFilter;
    return matchesSearch && matchesCategory && matchesStatus;
  }), [rows, search, category, statusFilter]);

  const statusClasses = (s) => (s === STATUS.IN ? 'text-green-600' : s === STATUS.LOW ? 'text-orange-500' : s === STATUS.OUT ? 'text-red-600' : 'text-stone-600');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {[
          { label: 'Total Lots', value: summary.total },
          { label: 'Low / Out of Stock', value: summary.lowStock + summary.outOfStock },
          { label: 'Units in Stock', value: rows.reduce((s, r) => s + r.stock, 0).toLocaleString('en-IN') },
          { label: 'Total Stock Value (MRP)', value: formatINR(summary.stockValue) },
        ].map((stat, i) => (
          <div key={i} className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 shadow-sm">
            <p className="text-stone-500 text-[10px] font-bold uppercase mb-2 tracking-wider">{stat.label}</p>
            <p className="text-2xl sm:text-3xl font-bold text-stone-900">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-stone-50/50 p-4 rounded-xl border border-stone-100">
        <div className="relative w-full md:flex-1 md:max-w-md">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">search</span>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by product or lot number..." className="pl-10 w-full border border-stone-200 rounded-lg py-2.5 text-sm focus:ring-[#EA2831] bg-white" />
        </div>
        <div className="flex w-full md:w-auto gap-3">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="flex-1 md:min-w-[140px] border border-stone-200 rounded-lg text-sm px-4 py-2.5 bg-white">
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="flex-1 md:min-w-[140px] border border-stone-200 rounded-lg text-sm px-4 py-2.5 bg-white">
            {['All', STATUS.IN, STATUS.LOW, STATUS.OUT].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-collapse min-w-[1000px] resp-table">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200">
                {['Product Details', 'Category', 'Lot / Warehouse', 'Stock', 'Reorder At', 'Expiry', 'Status'].map((h) => (
                  <th key={h} className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filtered.map((item) => {
                const status = statusOf(item);
                const badge = expiryBadge(item.expiryDate);
                return (
                  <tr key={item.id} className="hover:bg-stone-50/30 transition-colors">
                    <td data-label="Product Details" className="px-6 py-5">
                      <p className="font-bold text-stone-900 text-sm">{item.name}</p>
                      <p className="text-[10px] font-bold text-stone-400 uppercase tracking-tight">Lot: {item.lotNo}</p>
                    </td>
                    <td data-label="Category" className="px-6 py-5 text-sm text-stone-500 font-medium">{item.category}</td>
                    <td data-label="Lot / Warehouse" className="px-6 py-5 text-sm">
                      <p className="text-stone-900 font-medium">{item.warehouse}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td data-label="Stock" className="px-6 py-5 text-sm text-stone-900 font-bold">{item.stock.toLocaleString('en-IN')}</td>
                    <td data-label="Reorder At" className="px-6 py-5 text-sm text-stone-500 font-medium">{item.reorderLevel.toLocaleString('en-IN')}</td>
                    <td data-label="Expiry" className="px-6 py-5 text-sm text-stone-500 font-medium">{fmtDate(item.expiryDate)}</td>
                    <td data-label="Status" className="px-6 py-5 text-sm"><span className={`font-bold ${statusClasses(status)}`}>{status}</span></td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && <tr><td colSpan={7} className="px-6 py-10 text-center text-sm text-stone-400">No stock yet — it appears after your company approves a supply request.</td></tr>}
              {loading && <tr><td colSpan={7} className="px-6 py-10 text-center text-sm text-stone-400">Loading stock…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

/* ───────────── Lots (read-only list) ───────────── */
const LotsTab = ({ lots, loading }) => {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const visible = useMemo(() => {
    const live = lots.filter((l) => l.availableStock > 0);
    if (filter === 'expiring') return live.filter((l) => { const d = daysToExpiry(l.expiryDate); return d !== null && d >= 0 && d <= 90; });
    if (filter === 'expired') return live.filter((l) => daysToExpiry(l.expiryDate) < 0);
    return live;
  }, [lots, filter]);

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {[['all', 'All Lots'], ['expiring', 'Expiring ≤ 90d'], ['expired', 'Expired']].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`text-xs font-bold px-4 py-2 rounded-full border transition-colors ${filter === k ? 'bg-[#EA2831] border-[#EA2831] text-white' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-collapse min-w-[1000px] resp-table">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200">
                {['Lot No.', 'Product', 'Warehouse', 'Mfg', 'Expiry', 'Qty', 'Status', ''].map((h, i) => (
                  <th key={i} className={`px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest ${i === 7 ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {visible.map((lot) => {
                const p = lot.productId || {};
                const badge = expiryBadge(lot.expiryDate);
                return (
                  <tr key={lot._id} className="hover:bg-stone-50/30 transition-colors">
                    <td className="px-6 py-5" data-label="Lot No.">
                      <span className="text-xs font-bold bg-stone-100 text-stone-600 px-2.5 py-1 rounded-full">{lot.lotNumber || lot.batchNumber}</span>
                    </td>
                    <td className="px-6 py-5" data-label="Product">
                      <p className="font-bold text-stone-900 text-sm">{p.productName || '—'}</p>
                      <p className="text-[10px] font-bold text-stone-400 uppercase">{p.category || ''}</p>
                    </td>
                    <td className="px-6 py-5 text-sm text-stone-500 font-medium" data-label="Warehouse">{lot.warehouseId?.name || 'Unassigned'}</td>
                    <td className="px-6 py-5 text-sm text-stone-500 font-medium" data-label="Mfg">{fmtDate(lot.mfgDate)}</td>
                    <td className="px-6 py-5 text-sm text-stone-500 font-medium" data-label="Expiry">{fmtDate(lot.expiryDate)}</td>
                    <td className="px-6 py-5 text-sm text-stone-900 font-bold" data-label="Qty">{lot.availableStock.toLocaleString('en-IN')}</td>
                    <td className="px-6 py-5" data-label="Status"><span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badge.cls}`}>{badge.label}</span></td>
                    <td className="px-6 py-5 cell-actions">
                      <div className="flex items-center justify-end">
                        <button onClick={() => navigate(`/seller/labels?lot=${lot._id}`)} title="Print / scan labels"
                          className="inline-flex items-center gap-1 text-xs font-bold text-stone-500 hover:text-[#EA2831] transition-colors">
                          <span className="material-symbols-outlined text-sm">qr_code_2</span> Label
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && visible.length === 0 && <tr><td colSpan={8} className="px-6 py-12 text-center text-sm text-stone-400">No lots here.</td></tr>}
              {loading && <tr><td colSpan={8} className="px-6 py-12 text-center text-sm text-stone-400">Loading lots…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const Stat = ({ label, value, accent }) => (
  <div className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 shadow-sm">
    <p className="text-stone-500 text-[10px] font-bold uppercase mb-2 tracking-wider">{label}</p>
    <p className={`text-2xl sm:text-3xl font-bold ${accent || 'text-stone-900'}`}>{value}</p>
  </div>
);

/** Search-filter live lots and FEFO-sort (soonest expiry first, nulls last). */
function filterAndSortByExpiry(live, search) {
  const q = search.toLowerCase();
  const matched = live.filter((l) => {
    const p = l.productId || {};
    return (p.productName || '').toLowerCase().includes(q) || (l.lotNumber || '').toLowerCase().includes(q) ||
      (l.batchNumber || '').toLowerCase().includes(q) || (p.brandName || '').toLowerCase().includes(q);
  });
  return matched.slice().sort((a, b) => {
    if (!a.expiryDate && !b.expiryDate) return 0;
    if (!a.expiryDate) return 1;
    if (!b.expiryDate) return -1;
    return new Date(a.expiryDate) - new Date(b.expiryDate);
  });
}

/* ───────────── Batches (expiry / FEFO dashboard) ───────────── */
const BatchesTab = ({ lots, loading }) => {
  const [search, setSearch] = useState('');
  const live = useMemo(() => lots.filter((l) => l.availableStock > 0), [lots]);
  const expiring = live.filter((l) => { const d = daysToExpiry(l.expiryDate); return d !== null && d >= 0 && d <= 90; });
  const expired = live.filter((l) => daysToExpiry(l.expiryDate) < 0);
  const totalUnits = live.reduce((s, l) => s + l.availableStock, 0);

  const filtered = filterAndSortByExpiry(live, search);

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <Stat label="Live Lots" value={live.length} />
        <Stat label="Units in Stock" value={totalUnits.toLocaleString('en-IN')} />
        <Stat label="Expiring ≤ 90 Days" value={expiring.length} accent="text-orange-500" />
        <Stat label="Expired Lots" value={expired.length} accent="text-red-600" />
      </div>

      {(expired.length > 0 || expiring.length > 0) && (
        <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-xl p-4">
          <span className="material-symbols-outlined text-orange-500">event_busy</span>
          <div>
            <p className="font-bold text-stone-900 text-sm">
              {expired.length > 0 && `${expired.length} expired lot(s) still in stock. `}
              {expiring.length > 0 && `${expiring.length} lot(s) expire within 90 days.`}
            </p>
            <p className="text-xs text-stone-500">Sell soonest-expiring stock first (FEFO).</p>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-stone-50/50 p-4 rounded-xl border border-stone-100">
        <div className="relative w-full md:flex-1 md:max-w-md">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">search</span>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product, brand or lot number..." className="pl-10 w-full border border-stone-200 rounded-lg py-2.5 text-sm focus:ring-[#EA2831] bg-white" />
        </div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Sorted by expiry — first row sells first (FEFO)</p>
      </div>

      <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-collapse min-w-[1000px] resp-table">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200">
                {['Product', 'Type / Category', 'Brand', 'Packing Size', 'Lot No.', 'Qty', 'MRP', 'Expiry', 'Status'].map((h) => (
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
                    <td data-label="Product" className="px-6 py-5">
                      <p className="font-bold text-stone-900 text-sm">{p.productName || '—'}</p>
                      <p className="text-[10px] font-bold text-stone-400 uppercase tracking-tight">SKU: {p.skuNumber || '—'}</p>
                    </td>
                    <td data-label="Type / Category" className="px-6 py-5 text-sm text-stone-500 font-medium">{p.category || '—'}{p.unitType ? <span className="text-stone-400"> → {p.unitType}</span> : null}</td>
                    <td data-label="Brand" className="px-6 py-5 text-sm text-stone-500 font-medium">{p.brandName || '—'}</td>
                    <td data-label="Packing Size" className="px-6 py-5 text-sm text-stone-500 font-medium">{p.packagingType || '—'}{p.unit ? ` · ${p.unit}` : ''}</td>
                    <td data-label="Lot No." className="px-6 py-5"><span className="text-xs font-bold bg-stone-100 text-stone-600 px-2.5 py-1 rounded-full">{lot.lotNumber || lot.batchNumber}</span></td>
                    <td data-label="Qty" className="px-6 py-5 text-sm text-stone-900 font-bold">{lot.availableStock.toLocaleString('en-IN')}</td>
                    <td data-label="MRP" className="px-6 py-5 text-sm text-stone-900 font-bold">{formatINR(p.mrp)}</td>
                    <td data-label="Expiry" className="px-6 py-5 text-sm text-stone-500 font-medium">{fmtDate(lot.expiryDate)}</td>
                    <td data-label="Status" className="px-6 py-5"><span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badge.cls}`}>{badge.label}</span></td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && <tr><td colSpan={9} className="px-6 py-12 text-center text-sm text-stone-400">No lots in stock yet.</td></tr>}
              {loading && <tr><td colSpan={9} className="px-6 py-12 text-center text-sm text-stone-400">Loading lots…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SellerInventory;
