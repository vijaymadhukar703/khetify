import React, { useEffect, useMemo, useState } from 'react';
import Swal from 'sweetalert2';
import { getReportList, runReport, downloadReportCsv, getWarehouses } from '../../../lib/imsApi';
import { PrimaryBtn, GhostBtn } from './ImsUi';

const apiError = (err) => Swal.fire({ icon: 'error', title: err?.response?.data?.message || err.message || 'Error', toast: true, position: 'top-end', timer: 2600, showConfirmButton: false });
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);

const LABELS = {
  'stock-on-hand': 'Stock on Hand', 'stock-aging': 'Stock Aging', 'expiry-risk': 'Expiry Risk',
  'movement-register': 'Movement Register', 'warehouse-utilization': 'Warehouse Utilization',
  'fill-rate-otif': 'Fill Rate & OTIF', 'fast-slow-movers': 'Fast / Slow Movers',
  'transporter-performance': 'Transporter Performance', 'gst-sales-register': 'GST Sales Register',
  'gst-hsn-summary': 'GST HSN Summary',
};

/** Reports explorer — pick a report, filter, view a table, export CSV. */
const ImsAnalytics = () => {
  const [reports, setReports] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [name, setName] = useState('stock-on-hand');
  const [filters, setFilters] = useState({ from: '', to: '', warehouseId: '' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getReportList().then((r) => setReports(listOf(r))).catch(apiError);
    getWarehouses().then((r) => setWarehouses(listOf(r))).catch(() => {});
  }, []);

  const run = () => {
    setLoading(true);
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    runReport(name, params).then((r) => setRows(listOf(r))).catch((e) => { apiError(e); setRows([]); }).finally(() => setLoading(false));
  };
  useEffect(run, [name]); // re-run when report changes

  const columns = useMemo(() => (rows[0] ? Object.keys(rows[0]) : []), [rows]);
  const download = async () => {
    try { await downloadReportCsv(name, Object.fromEntries(Object.entries(filters).filter(([, v]) => v))); } catch (e) { apiError(e); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase text-stone-400">Report</label>
            <select value={name} onChange={(e) => setName(e.target.value)} className="block border border-stone-200 rounded-lg text-sm px-3 py-2 bg-white font-medium mt-1">
              {reports.map((r) => <option key={r.name} value={r.name}>{LABELS[r.name] || r.name}{r.advanced ? ' ★' : ''}</option>)}
            </select>
          </div>
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
        <p className="text-[11px] text-stone-400">★ advanced reports require the Pro/Enterprise plan. {rows.length} row(s).</p>

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

export default ImsAnalytics;
