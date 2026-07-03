import React, { useEffect, useMemo, useState } from 'react';
import Swal from 'sweetalert2';
import {
  getOrders, getOrder, getOrderPicklist, updateOrderStatus, createShipment, formatINR, fmtDate,
} from '../../lib/imsApi';
import { Modal, PrimaryBtn, GhostBtn, Th } from './ims/ImsUi';

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) =>
  toast('error', err?.response?.data?.message || err.message || 'Something went wrong');

const STATUS_STYLES = {
  pending: 'bg-stone-100 text-stone-600',
  confirmed: 'bg-blue-50 text-blue-600',
  packed: 'bg-indigo-50 text-indigo-600',
  shipped: 'bg-orange-50 text-orange-600',
  delivered: 'bg-green-50 text-green-600',
  returned: 'bg-red-50 text-red-600',
  cancelled: 'bg-stone-100 text-stone-400',
};
const LABEL = {
  pending: 'Pending', confirmed: 'Approved', packed: 'Packed', shipped: 'In Transit',
  delivered: 'Delivered', returned: 'Returned', cancelled: 'Cancelled',
};
// What the "next state" button should say.
const ACTION = {
  confirmed: { label: 'Approve', cls: 'bg-green-600 hover:bg-green-700' },
  cancelled: { label: 'Reject', cls: 'bg-stone-500 hover:bg-stone-600' },
  packed: { label: 'Mark Packed', cls: 'bg-indigo-600 hover:bg-indigo-700' },
  shipped: { label: 'Dispatch (deduct FEFO)', cls: 'bg-[#EA2831] hover:bg-[#c91e26]' },
  delivered: { label: 'Mark Delivered', cls: 'bg-green-600 hover:bg-green-700' },
  returned: { label: 'Mark Returned', cls: 'bg-red-600 hover:bg-red-700' },
};
const FILTERS = ['all', 'pending', 'confirmed', 'packed', 'shipped', 'delivered'];

const CompanyOrders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);

  const refresh = () =>
    getOrders()
      .then((r) => r?.success && setOrders(r.data))
      .catch(apiError)
      .finally(() => setLoading(false));

  useEffect(() => { refresh(); }, []);

  const counts = useMemo(() => {
    const c = { pending: 0, processing: 0, shipped: 0, delivered: 0 };
    for (const o of orders) {
      if (o.status === 'pending') c.pending++;
      else if (o.status === 'confirmed' || o.status === 'packed') c.processing++;
      else if (o.status === 'shipped') c.shipped++;
      else if (o.status === 'delivered') c.delivered++;
    }
    return c;
  }, [orders]);

  const visible = useMemo(
    () => (filter === 'all' ? orders : orders.filter((o) => o.status === filter)),
    [orders, filter]
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {[
            { label: 'Pending Approval', value: counts.pending, accent: 'text-stone-900' },
            { label: 'Processing', value: counts.processing, accent: 'text-blue-600' },
            { label: 'In Transit', value: counts.shipped, accent: 'text-orange-500' },
            { label: 'Delivered', value: counts.delivered, accent: 'text-emerald-600' },
          ].map((s) => (
            <div key={s.label} className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 shadow-sm">
              <p className="text-stone-500 text-[10px] font-bold uppercase mb-2 tracking-wider">{s.label}</p>
              <p className={`text-2xl sm:text-3xl font-bold ${s.accent}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`text-xs font-bold px-4 py-2 rounded-full border transition-colors capitalize ${
                filter === k ? 'bg-[#EA2831] border-[#EA2831] text-white' : 'border-stone-200 text-stone-500 hover:bg-stone-50'
              }`}
            >
              {k === 'all' ? 'All Orders' : LABEL[k]}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[900px] resp-table">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200">
                  <Th>Order</Th><Th>Customer</Th><Th>Items</Th><Th>Units</Th>
                  <Th>Amount</Th><Th>Placed</Th><Th>Status</Th><Th right>Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {visible.map((o) => (
                  <tr key={o._id} className="hover:bg-stone-50/30 transition-colors">
                    <td data-label="Order" className="px-6 py-5 text-sm font-bold text-stone-900">{o.orderNumber || o._id.slice(-6)}</td>
                    <td data-label="Customer" className="px-6 py-5 text-sm text-stone-600 font-medium">{o.customerName || '—'}</td>
                    <td data-label="Items" className="px-6 py-5 text-sm text-stone-500">{(o.items || []).length} line(s)</td>
                    <td data-label="Units" className="px-6 py-5 text-sm text-stone-900 font-bold">{(o.totalUnits || 0).toLocaleString('en-IN')}</td>
                    <td data-label="Amount" className="px-6 py-5 text-sm text-stone-900 font-bold">{formatINR(o.totalAmount)}</td>
                    <td data-label="Placed" className="px-6 py-5 text-sm text-stone-500">{fmtDate(o.placedAt)}</td>
                    <td data-label="Status" className="px-6 py-5">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_STYLES[o.status]}`}>{LABEL[o.status]}</span>
                    </td>
                    <td className="px-6 py-5 text-right cell-actions">
                      <GhostBtn onClick={() => setOpenId(o._id)}>Manage</GhostBtn>
                    </td>
                  </tr>
                ))}
                {!loading && visible.length === 0 && (
                  <tr><td colSpan={8} className="px-6 py-12 text-center text-sm text-stone-400">No orders here.</td></tr>
                )}
                {loading && (
                  <tr><td colSpan={8} className="px-6 py-12 text-center text-sm text-stone-400">Loading orders…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {openId && (
        <OrderDetailModal
          orderId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => { refresh(); }}
        />
      )}
    </div>
  );
};

/* ---------- order detail + fulfillment ---------- */

const OrderDetailModal = ({ orderId, onClose, onChanged }) => {
  const [order, setOrder] = useState(null);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    getOrder(orderId).then((r) => r?.success && setOrder(r.data)).catch(apiError);
    getOrderPicklist(orderId).then((r) => r?.success && setPick(r.data)).catch(() => {});
  };
  useEffect(load, [orderId]);

  const move = async (status) => {
    setBusy(true);
    try {
      await updateOrderStatus(orderId, status);
      toast('success', `Order marked ${LABEL[status] || status}`);
      load();
      onChanged();
    } catch (err) { apiError(err); }
    finally { setBusy(false); }
  };

  const makeShipment = async () => {
    try {
      await createShipment({ toLabel: order.customerName || 'Customer', notes: `Order ${order.orderNumber || ''}` });
      toast('success', 'Shipment created in Transport');
      onChanged();
    } catch (err) { apiError(err); }
  };

  if (!order) {
    return <Modal title="Order" onClose={onClose}><p className="text-sm text-stone-400">Loading…</p></Modal>;
  }

  return (
    <Modal title={`Order ${order.orderNumber || order._id.slice(-6)}`} onClose={onClose} wide>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-bold text-stone-900">{order.customerName || '—'}</p>
          <p className="text-xs text-stone-400">Placed {fmtDate(order.placedAt)} · {order.channel} channel</p>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_STYLES[order.status]}`}>{LABEL[order.status]}</span>
      </div>

      {/* Line items */}
      <div className="border border-stone-200 rounded-xl overflow-hidden mb-5">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50">
            <tr className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">
              <th className="px-4 py-2.5">Product</th><th className="px-4 py-2.5">Qty</th>
              <th className="px-4 py-2.5">Price</th><th className="px-4 py-2.5 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {(order.items || []).map((it, i) => (
              <tr key={i}>
                <td className="px-4 py-2.5 font-medium text-stone-800">{it.name}</td>
                <td className="px-4 py-2.5 text-stone-600">{it.qty}</td>
                <td className="px-4 py-2.5 text-stone-600">{formatINR(it.price)}</td>
                <td className="px-4 py-2.5 text-right font-bold text-stone-900">{formatINR(it.qty * it.price)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-stone-50/60">
            <tr className="text-sm font-bold text-stone-900">
              <td className="px-4 py-2.5" colSpan={3}>Total · {order.totalUnits} units</td>
              <td className="px-4 py-2.5 text-right">{formatINR(order.totalAmount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* FEFO pick list */}
      {pick && (
        <div className="mb-5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">Pick List (FEFO — earliest expiry first)</p>
          <div className="space-y-2">
            {pick.lines.map((ln, i) => (
              <div key={i} className="text-xs bg-stone-50 border border-stone-100 rounded-lg p-3">
                <div className="flex justify-between font-bold text-stone-800 mb-1">
                  <span>{ln.name}</span><span>{ln.qty} units</span>
                </div>
                {ln.picks.length === 0 && <p className="text-stone-400">No stock available</p>}
                {ln.picks.map((p, j) => (
                  <div key={j} className="flex justify-between text-stone-500">
                    <span>{p.lotNumber} · {p.warehouse}</span><span className="font-medium">take {p.take}</span>
                  </div>
                ))}
                {ln.shortfall > 0 && <p className="text-[#EA2831] font-bold mt-1">Short by {ln.shortfall} units</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Workflow actions */}
      <div className="flex flex-wrap items-center gap-2">
        {(order.nextStates || []).map((s) => (
          <button
            key={s}
            disabled={busy}
            onClick={() => move(s)}
            className={`inline-flex items-center gap-1.5 text-white text-sm font-bold rounded-lg px-4 py-2.5 transition-colors disabled:opacity-40 ${ACTION[s]?.cls || 'bg-stone-700'}`}
          >
            {ACTION[s]?.label || s}
          </button>
        ))}
        {(order.status === 'packed' || order.status === 'shipped') && (
          <GhostBtn onClick={makeShipment}>
            <span className="material-symbols-outlined text-sm">local_shipping</span> Create Shipment
          </GhostBtn>
        )}
        {(order.nextStates || []).length === 0 && (
          <p className="text-sm text-stone-400">No further action — order is {LABEL[order.status]}.</p>
        )}
      </div>
    </Modal>
  );
};

export default CompanyOrders;
