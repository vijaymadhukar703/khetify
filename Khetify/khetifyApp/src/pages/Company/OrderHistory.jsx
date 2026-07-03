import React, { useEffect, useMemo, useState } from 'react';
import { getOrderHistory, getWarehouses, formatINR } from '../../lib/imsApi';
import { StatCard, inputCls } from './ims/ImsUi';
import { movementKind } from '../../lib/movementLabel';

// ORDER HISTORY — a dedicated, searchable history across seller orders,
// warehouse transfers and shipments. Filters by date, seller, warehouse,
// product and status; each row expands to its status timeline.

// Two user-facing terms only: internal warehouse moves => "Transfer", anything
// with an outside party => "Sales". Used as a fallback when a row doesn't carry
// the toType/refType/type fields movementKind() reads.
const KIND_LABEL = { seller: 'Sales', transfer: 'Transfer', shipment: 'Sales' };
// Prefer the field-driven kind (so a warehouse shipment reads "Transfer" and a
// customer shipment reads "Sales"); fall back to the per-row map above.
const kindLabel = (r) => movementKind(r) || KIND_LABEL[r.kind] || r.kind;
const KIND_STYLE = {
  seller: 'bg-blue-50 text-blue-700',
  transfer: 'bg-amber-50 text-amber-700',
  shipment: 'bg-violet-50 text-violet-700',
};

const STATUS_STYLE = (s) => {
  if (['delivered', 'received', 'fulfilled'].includes(s)) return 'bg-green-50 text-green-700';
  if (['cancelled', 'rejected', 'exception', 'returned'].includes(s)) return 'bg-red-50 text-red-700';
  if (['pending', 'requested', 'draft'].includes(s)) return 'bg-stone-100 text-stone-600';
  return 'bg-yellow-50 text-yellow-700';
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const OrderHistory = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState([]);
  const [expanded, setExpanded] = useState(null);

  const [filters, setFilters] = useState({ type: '', status: '', warehouseId: '', from: '', to: '', q: '' });

  const load = () => {
    setLoading(true);
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    getOrderHistory(params)
      .then((r) => setRows(r?.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { getWarehouses().then((r) => setWarehouses(r?.data || r || [])).catch(() => {}); }, []);

  const totals = useMemo(() => {
    const value = rows.reduce((s, r) => s + (r.total || 0), 0);
    const byKind = rows.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] || 0) + 1 }), {});
    return { count: rows.length, value, byKind };
  }, [rows]);

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 font-sora">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Order History</h1>
      <p className="text-stone-500 mb-5">Every order, transfer and shipment — searchable in one place.</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Records" value={totals.count} />
        <StatCard label="Seller orders" value={totals.byKind.seller || 0} />
        <StatCard label="Transfers" value={totals.byKind.transfer || 0} />
        <StatCard label="Total value" value={formatINR(totals.value)} />
      </div>

      {/* Filters */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 mb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <select className={inputCls} value={filters.type} onChange={set('type')}>
          <option value="">All types</option>
          <option value="seller">Seller orders</option>
          <option value="transfer">Transfers</option>
          <option value="shipment">Shipments</option>
        </select>
        <select className={inputCls} value={filters.status} onChange={set('status')}>
          <option value="">All statuses</option>
          {['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className={inputCls} value={filters.warehouseId} onChange={set('warehouseId')}>
          <option value="">All warehouses</option>
          {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
        </select>
        <input type="date" className={inputCls} value={filters.from} onChange={set('from')} title="From" />
        <input type="date" className={inputCls} value={filters.to} onChange={set('to')} title="To" />
        <input className={inputCls} placeholder="Search ref / party…" value={filters.q} onChange={set('q')} />
      </div>
      <div className="flex gap-2 mb-5">
        <button onClick={load} className="inline-flex items-center gap-2 bg-[#EA2831] hover:bg-[#c91e26] text-white text-sm font-bold rounded-lg px-5 py-2.5 transition-colors">
          <span className="material-symbols-outlined text-base">search</span> Apply filters
        </button>
        <button onClick={() => { setFilters({ type: '', status: '', warehouseId: '', from: '', to: '', q: '' }); setTimeout(load, 0); }}
          className="inline-flex items-center gap-1.5 border border-stone-200 hover:bg-stone-50 text-stone-700 text-sm font-bold rounded-lg px-4 py-2.5 transition-colors">
          Clear
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[720px] resp-table">
          <thead>
            <tr className="border-b border-stone-200">
              {['Ref', 'Type', 'Party', 'Status', 'Units', 'Value', 'Date', ''].map((h, i) => (
                <th key={i} className="px-5 py-3.5 text-[10px] font-bold text-stone-400 uppercase tracking-widest">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-stone-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-stone-400">No history matches your filters yet.</td></tr>
            ) : rows.map((r) => (
              <React.Fragment key={`${r.kind}-${r.id}`}>
                <tr className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                  <td data-label="Ref" className="px-5 py-3.5 font-bold text-stone-800 text-sm">{r.ref}</td>
                  <td data-label="Type" className="px-5 py-3.5"><span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${KIND_STYLE[r.kind]}`}>{kindLabel(r)}</span></td>
                  <td data-label="Party" className="px-5 py-3.5 text-sm text-stone-600">{r.party}</td>
                  <td data-label="Status" className="px-5 py-3.5"><span className={`text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${STATUS_STYLE(r.status)}`}>{r.status}</span></td>
                  <td data-label="Units" className="px-5 py-3.5 text-sm text-stone-600">{r.units || '—'}</td>
                  <td data-label="Value" className="px-5 py-3.5 text-sm font-semibold text-stone-800">{r.total ? formatINR(r.total) : '—'}</td>
                  <td data-label="Date" className="px-5 py-3.5 text-sm text-stone-500">{fmtDate(r.date)}</td>
                  <td className="px-5 py-3.5 text-right cell-actions">
                    <span className={`material-symbols-outlined text-stone-300 transition-transform ${expanded === r.id ? 'rotate-180' : ''}`}>expand_more</span>
                  </td>
                </tr>
                {expanded === r.id && (
                  <tr className="bg-stone-50/60">
                    <td colSpan={8} className="px-5 py-4">
                      <Timeline row={r} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Timeline = ({ row }) => {
  // Seller orders carry the canonical 5-step timeline; shipments carry their
  // own statusHistory; transfers have no sub-steps.
  if (row.timeline && row.timeline.length && row.timeline[0].step) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {row.timeline.map((t, i) => (
          <React.Fragment key={i}>
            <div className={`flex items-center gap-1.5 text-xs font-semibold ${t.done === false ? 'text-stone-300' : 'text-stone-700'}`}>
              <span className={`h-2 w-2 rounded-full ${t.done === false ? 'bg-stone-300' : 'bg-[#EA2831]'}`} />
              <span className="capitalize">{t.step}{t.at ? ` · ${fmtDate(t.at)}` : ''}</span>
            </div>
            {i < row.timeline.length - 1 && <span className="text-stone-300">→</span>}
          </React.Fragment>
        ))}
      </div>
    );
  }
  return <p className="text-sm text-stone-400">No detailed timeline for this record.</p>;
};

export default OrderHistory;
