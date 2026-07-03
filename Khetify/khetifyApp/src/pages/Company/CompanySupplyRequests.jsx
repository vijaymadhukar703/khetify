import React, { useCallback, useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { getSupplyOrders, updateSupplyStatus, getSupplySourceOptions } from '../../lib/imsApi';
import BackButton from '../../Components/BackButton';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtNum = (n) => Number(n || 0).toLocaleString('en-IN');

const STATUS_STYLE = {
  requested: 'bg-amber-50 text-amber-700', under_review: 'bg-amber-50 text-amber-700',
  approved: 'bg-blue-50 text-blue-700', picking: 'bg-blue-50 text-blue-700', packed: 'bg-indigo-50 text-indigo-700',
  dispatched: 'bg-violet-50 text-violet-700', in_transit: 'bg-violet-50 text-violet-700', arrived: 'bg-violet-50 text-violet-700',
  partially_received: 'bg-amber-50 text-amber-700', received: 'bg-green-50 text-green-700',
  delivered: 'bg-green-50 text-green-700', rejected: 'bg-red-50 text-red-700', cancelled: 'bg-stone-100 text-stone-500',
};

// SUPPLY REQUESTS — incoming bulk-supply requests from the dealers this company
// supplies. Approving asks the company to ASSIGN A SOURCE WAREHOUSE, then runs
// the lot-accurate company → seller transfer (FEFO from that warehouse).
const CompanySupplyRequests = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false); // plan lacks the supply workflow
  const [approving, setApproving] = useState(null); // the order whose source-warehouse modal is open

  const load = useCallback(() => {
    getSupplyOrders()
      .then((r) => { setRows(listOf(r)); setBlocked(false); })
      .catch((e) => {
        if (e?.response?.status === 403) setBlocked(true);
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (o, status, extra = {}) => {
    try { await updateSupplyStatus(o._id, { status, ...extra }); toast('success', `Marked ${status}`); load(); }
    catch (e) { toast('error', e?.response?.data?.message || 'Action failed'); }
  };

  const reject = async (o) => {
    const { isConfirmed } = await Swal.fire({ title: 'Reject this request?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'Reject' });
    if (isConfirmed) act(o, 'rejected');
  };

  const actionsFor = (o) => {
    if (['requested', 'under_review'].includes(o.status)) {
      return (
        <div className="flex items-center gap-2">
          <button onClick={() => setApproving(o)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#EA2831] text-white hover:bg-red-600">Approve</button>
          <button onClick={() => reject(o)} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">Reject</button>
        </div>
      );
    }
    // After approval the stock is RESERVED and the order flows through SEND
    // STOCK: Operations picks, packs and prints a shipping label, then dispatch
    // creates the shipment. The SELLER scans the manifest to receive. The order
    // status mirrors the pipeline automatically.
    if (o.status === 'approved') return <span className="text-[11px] font-bold text-stone-500">Reserved — pick in Send Stock</span>;
    if (o.status === 'picking') return <span className="text-[11px] font-bold text-blue-600">Picking in Send Stock</span>;
    if (o.status === 'packed') return <span className="text-[11px] font-bold text-indigo-600">Packed — print label &amp; dispatch</span>;
    if (['dispatched', 'in_transit', 'arrived'].includes(o.status)) return <span className="text-[11px] font-bold text-violet-600">In transit — awaiting seller scan</span>;
    if (o.status === 'partially_received') return <span className="text-[11px] font-bold text-amber-600">Received with discrepancies</span>;
    if (['received', 'delivered'].includes(o.status)) return <span className="text-[11px] font-bold text-green-600">✓ Received &amp; verified</span>;
    return <span className="text-[11px] text-stone-400">—</span>;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 font-sora">
      <BackButton />
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Supply Requests</h1>
      <p className="text-stone-500 mb-5">Bulk-supply requests from the dealers you supply. Approving reserves stock (FEFO) from a source warehouse you assign; pick, pack and dispatch it from Send Stock.</p>

      {blocked ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center max-w-xl mx-auto mt-8">
          <span className="material-symbols-outlined text-amber-500 text-4xl">workspace_premium</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Supply workflow is a premium feature</h2>
          <p className="text-sm text-amber-700 mt-1">Upgrade your plan to manage seller supply requests.</p>
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[920px] resp-table">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50/50">
                {['Seller', 'Items', 'Destination', 'Source', 'Status', 'Requested', 'Actions'].map((h) => (
                  <th key={h} className="px-5 py-3.5 text-[10px] font-bold text-stone-400 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-stone-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-stone-400">No supply requests yet.</td></tr>
              ) : rows.map((o) => (
                <tr key={o._id} className="hover:bg-stone-50/60">
                  <td data-label="Seller" className="px-5 py-3.5 font-bold text-stone-800 text-sm">{o.sellerId?.sellerInfo?.businessName || '—'}</td>
                  <td data-label="Items" className="px-5 py-3.5 text-sm text-stone-600">
                    {(o.items || []).map((it) => `${it.productId?.productName || 'Item'} ×${it.quantity}`).join(', ')}
                  </td>
                  <td data-label="Destination" className="px-5 py-3.5 text-sm text-stone-600">{o.warehouseId?.name || '—'}</td>
                  <td data-label="Source" className="px-5 py-3.5 text-sm text-stone-600">{o.sourceWarehouseId?.name || '—'}</td>
                  <td data-label="Status" className="px-5 py-3.5"><span className={`text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${STATUS_STYLE[o.status] || 'bg-stone-100 text-stone-500'}`}>{o.status?.replace('_', ' ')}</span></td>
                  <td data-label="Requested" className="px-5 py-3.5 text-sm text-stone-500">{fmtDate(o.createdAt)}</td>
                  <td data-label="Actions" className="px-5 py-3.5 cell-actions">{actionsFor(o)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approving && (
        <SourceWarehouseModal
          order={approving}
          onClose={() => setApproving(null)}
          onConfirm={async (warehouseId) => {
            await act(approving, 'approved', { sourceWarehouseId: warehouseId });
            setApproving(null);
          }}
        />
      )}
    </div>
  );
};

// "Assign a source warehouse" — shows each company warehouse's AVAILABLE qty of
// the requested product(s), sorts fulfilling warehouses first, disables ones
// that can't cover the request, and only enables Approve for a fulfilling pick.
const SourceWarehouseModal = ({ order, onClose, onConfirm }) => {
  const [options, setOptions] = useState(null); // null = loading
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSupplySourceOptions(order._id)
      .then((r) => setOptions(listOf(r)))
      .catch(() => setOptions([]));
  }, [order._id]);

  const multi = (order.items || []).length > 1;
  const anyFulfills = (options || []).some((o) => o.canFulfill);
  const chosen = (options || []).find((o) => String(o.warehouseId) === String(selected));

  const confirm = async () => {
    if (!chosen?.canFulfill) return;
    setBusy(true);
    try { await onConfirm(selected); } catch { /* surfaced by caller */ } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 font-sora" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-200">
          <h3 className="font-bold text-stone-900">Assign a source warehouse</h3>
          <p className="text-xs text-stone-500 mt-0.5">Stock is reserved FEFO from the chosen warehouse, then picked &amp; packed in Send Stock.</p>
        </div>

        <div className="p-4 overflow-y-auto space-y-2">
          {options === null && <p className="text-sm text-stone-400 text-center py-8">Checking availability…</p>}
          {options && options.length === 0 && <p className="text-sm text-stone-400 text-center py-8">No warehouses found. Add a warehouse first.</p>}

          {(options || []).map((w) => {
            const single = w.items[0];
            const disabled = !w.canFulfill;
            const isSel = String(selected) === String(w.warehouseId);
            return (
              <button
                key={w.warehouseId}
                type="button"
                disabled={disabled}
                onClick={() => setSelected(w.warehouseId)}
                className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                  disabled ? 'border-stone-200 bg-stone-50 opacity-60 cursor-not-allowed'
                    : isSel ? 'border-[#EA2831] bg-red-50/40'
                      : 'border-stone-200 hover:border-[#EA2831]/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm text-stone-800">
                    {w.name}{w.code ? <span className="text-stone-400 font-normal"> ({w.code})</span> : null}
                  </span>
                  {w.canFulfill
                    ? (!multi && <span className="text-xs font-bold text-green-600">{fmtNum(single.availableQty)} available</span>)
                    : <span className="text-[11px] font-bold text-red-500">Insufficient</span>}
                </div>
                {multi ? (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {w.items.map((it) => (
                      <span key={it.productId} className={`text-[11px] ${it.availableQty >= it.requiredQty ? 'text-stone-500' : 'text-red-500 font-bold'}`}>
                        {it.productName} {fmtNum(it.availableQty)}/{fmtNum(it.requiredQty)}
                      </span>
                    ))}
                  </div>
                ) : (
                  !w.canFulfill && <p className="mt-0.5 text-[11px] text-red-500">{fmtNum(single.availableQty)} available · needs {fmtNum(single.requiredQty)}</p>
                )}
              </button>
            );
          })}

          {options && options.length > 0 && !anyFulfills && (
            <p className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No single warehouse has enough stock for this request.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-200 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs font-bold px-4 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">Cancel</button>
          <button
            onClick={confirm}
            disabled={!chosen?.canFulfill || busy}
            className="text-xs font-bold px-4 py-2 rounded-lg bg-[#EA2831] text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Approving…' : 'Approve & reserve'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CompanySupplyRequests;
