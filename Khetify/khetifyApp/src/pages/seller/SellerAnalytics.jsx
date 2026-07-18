import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import {
  getSellerReportList, runSellerReport, downloadSellerReportCsv, getSellerWarehouses,
} from '../../lib/sellerApi';
import { PrimaryBtn, GhostBtn } from '../Company/ims/ImsUi';
import { useSellerPermission } from '../../context/SellerPermissionContext';

const apiError = (err) => Swal.fire({ icon: 'error', title: err?.response?.data?.message || err.message || 'Error', toast: true, position: 'top-end', timer: 2600, showConfirmButton: false });
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);
const isUpgrade = (err) => err?.response?.status === 403 || err?.response?.data?.code === 'UPGRADE_REQUIRED';

// Fixed to Stock on Hand — the report picker was removed, so this is the single
// report name sent to the seller report API and used for the CSV export.
const REPORT_NAME = 'stock-on-hand';

// `sku` is removed from the Analytics table for every role (mirrors the company
// ImsAnalytics). View-only: the seller report API still returns it and the CSV
// still exports it. Columns derive from the row keys, so filtering the key drops
// the column cleanly with no empty cell and the rest reflow.
const HIDDEN_COLS = ['sku'];

// Seller analytics — pick a report, filter, view a table, export CSV. Mirrors
// the company ImsAnalytics. Lot-level reports are a paid (owner) feature; a free
// seller sees an upgrade prompt (a manager is told to ask the admin).
const SellerAnalytics = () => {
  const navigate = useNavigate();
  const canBill = useSellerPermission('billing:manage');
  const [warehouses, setWarehouses] = useState([]);
  const [filters, setFilters] = useState({ from: '', to: '', warehouseId: '' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    // The report picker is gone, but this call is kept as the mount-time access
    // probe: a free (upgrade-gated) seller gets 403 → the Pro prompt, exactly as
    // before. Its report list is simply no longer rendered.
    getSellerReportList().catch((e) => { if (isUpgrade(e)) setLocked(true); });
    getSellerWarehouses().then((r) => setWarehouses(listOf(r))).catch(() => {});
  }, []);

  // setState only inside the promise callbacks (never synchronously in the
  // effect body) so the auto-run on report change stays lint-clean.
  const fetchRows = () => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    return runSellerReport(REPORT_NAME, params)
      .then((r) => { setRows(listOf(r)); setLocked(false); })
      .catch((e) => { if (isUpgrade(e)) { setLocked(true); setRows([]); } else { apiError(e); setRows([]); } });
  };
  const run = () => { setLoading(true); fetchRows().finally(() => setLoading(false)); };
  // Auto-load Stock on Hand on mount — no report selection is required.
  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = useMemo(() => (rows[0] ? Object.keys(rows[0]).filter((c) => !HIDDEN_COLS.includes(c)) : []), [rows]);
  const download = async () => {
    try { await downloadSellerReportCsv(REPORT_NAME, Object.fromEntries(Object.entries(filters).filter(([, v]) => v))); } catch (e) { apiError(e); }
  };

  if (locked) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">workspace_premium</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Analytics is a Pro feature</h2>
          <p className="text-sm text-amber-700 mt-1">
            {canBill
              ? 'Upgrade your plan to unlock stock, aging, expiry and movement reports.'
              : 'Ask your seller admin to upgrade the plan to unlock these reports.'}
          </p>
          {canBill && (
            <button onClick={() => navigate('/seller/billing')} className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-white bg-[#EA2831] hover:bg-red-600 rounded-lg px-4 py-2">
              <span className="material-symbols-outlined text-base">workspace_premium</span> View plans
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          {/* Report picker removed — the page is fixed to Stock on Hand
              (REPORT_NAME) and auto-loads it on mount. */}
          <div>
            <label className="text-[10px] font-bold uppercase text-stone-400">From</label>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="block border border-stone-200 rounded-lg text-sm px-3 py-2 mt-1" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-stone-400">To</label>
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="block border border-stone-200 rounded-lg text-sm px-3 py-2 mt-1" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-stone-400">Warehouse</label>
            <select value={filters.warehouseId} onChange={(e) => setFilters({ ...filters, warehouseId: e.target.value })} className="block border border-stone-200 rounded-lg text-sm px-3 py-2 bg-white mt-1">
              <option value="">All</option>
              {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
            </select>
          </div>
          <PrimaryBtn onClick={run}>Run</PrimaryBtn>
          <GhostBtn onClick={download} disabled={rows.length === 0}><span className="material-symbols-outlined text-sm">download</span> CSV</GhostBtn>
        </div>
        <p className="text-[11px] text-stone-400">{rows.length} row(s).</p>

        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead><tr className="bg-stone-50 border-b border-stone-200">
                {columns.map((c) => <th key={c} className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-stone-400 whitespace-nowrap">{c}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-stone-50/40">
                    {columns.map((c) => <td key={c} className="px-4 py-2.5 text-stone-700 whitespace-nowrap">{typeof r[c] === 'boolean' ? (r[c] ? 'Yes' : 'No') : String(r[c] ?? '')}</td>)}
                  </tr>
                ))}
                {!loading && rows.length === 0 && <tr><td colSpan={columns.length || 1} className="px-4 py-12 text-center text-stone-400">No data for this report / filter.</td></tr>}
                {loading && <tr><td colSpan={columns.length || 1} className="px-4 py-12 text-center text-stone-400">Loading…</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SellerAnalytics;
