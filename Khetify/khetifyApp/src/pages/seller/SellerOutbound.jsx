import React, { useCallback, useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { Modal, Field, inputCls, PrimaryBtn, GhostBtn, Th } from '../Company/ims/ImsUi';
import { formatINR, fmtDate } from '../../lib/imsApi';
import {
  getSellerLink, getSellerOrders, createSellerOrder, updateSellerOrderStatus,
  getSellerCustomers, getSellerProducts,
} from '../../lib/sellerApi';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);

const STATUS_STYLE = {
  pending: 'bg-stone-100 text-stone-600', confirmed: 'bg-blue-50 text-blue-700', packed: 'bg-amber-50 text-amber-700',
  shipped: 'bg-violet-50 text-violet-700', delivered: 'bg-green-50 text-green-700', returned: 'bg-orange-50 text-orange-700', cancelled: 'bg-red-50 text-red-700',
};
// The seller's ONLY action is to confirm (or cancel) a PENDING order. After
// confirmation the order belongs to the warehouse that holds the stock — it
// picks, packs, dispatches and delivers. The seller just watches the status
// progress (confirmed → packed → shipped → delivered), read-only, like the
// customer's order tracker. So no post-confirm actions are offered here.
const NEXT_ACTIONS = {
  pending: [['Confirm', 'confirmed'], ['Cancel', 'cancelled']],
};

const SellerOutbound = () => {
  const [approved, setApproved] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    getSellerOrders().then((r) => setOrders(listOf(r))).catch(apiError).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    getSellerLink()
      .then((r) => { const ok = r?.data?.linkStatus === 'approved'; setApproved(ok); if (ok) refresh(); })
      .catch(() => setApproved(false));
  }, [refresh]);

  const advance = async (o, status) => {
    if (status === 'confirmed') {
      const { isConfirmed } = await Swal.fire({
        title: 'Confirm this order?',
        text: 'Stock will be reserved for the customer.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#16a34a',
        confirmButtonText: 'Yes, confirm',
      });
      if (!isConfirmed) return;
    }
    if (status === 'cancelled') {
      const { isConfirmed } = await Swal.fire({ title: 'Cancel this order?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'Cancel order' });
      if (!isConfirmed) return;
    }
    try { await updateSellerOrderStatus(o._id, status); toast('success', `Marked ${status}`); refresh(); }
    catch (err) { apiError(err); }
  };

  if (approved === null) return <div className="flex-1 p-8 text-center text-stone-400 font-sora">Loading…</div>;
  if (!approved) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">lock</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Outbound Sales is locked</h2>
          <p className="text-sm text-amber-700 mt-1">Available after your supplying company approves you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-stone-900">Outbound Sales</h1>
            <p className="text-sm text-stone-500">Sell from your stock to customers and dealers. Shipping deducts stock FEFO.</p>
          </div>
          <PrimaryBtn onClick={() => setCreating(true)}><span className="material-symbols-outlined text-base">add_shopping_cart</span> New Order</PrimaryBtn>
        </div>

        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[860px] resp-table">
              <thead><tr className="bg-stone-50 border-b border-stone-200">
                <Th>Invoice</Th><Th>Buyer</Th><Th>Units</Th><Th>Total</Th><Th>Status</Th><Th>Placed</Th><Th right>Actions</Th>
              </tr></thead>
              <tbody className="divide-y divide-stone-100">
                {orders.map((o) => (
                  <tr key={o._id} className="hover:bg-stone-50/40">
                    <td data-label="Invoice" className="px-6 py-4 text-sm font-mono font-bold text-stone-800">{o.invoiceNumber || o.orderNumber}</td>
                    <td data-label="Buyer" className="px-6 py-4 text-sm text-stone-700">{o.customerName || '—'}</td>
                    <td data-label="Units" className="px-6 py-4 text-sm text-stone-600">{o.totalUnits}</td>
                    <td data-label="Total" className="px-6 py-4 text-sm font-semibold text-stone-800">{formatINR(o.totalAmount)}</td>
                    <td data-label="Status" className="px-6 py-4"><span className={`text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${STATUS_STYLE[o.status] || 'bg-stone-100'}`}>{o.status}</span></td>
                    <td data-label="Placed" className="px-6 py-4 text-sm text-stone-500">{fmtDate(o.placedAt)}</td>
                    <td className="px-6 py-4 cell-actions">
                      <div className="flex items-center justify-end gap-2">
                        {(NEXT_ACTIONS[o.status] || []).map(([label, status]) => (
                          <GhostBtn key={status} onClick={() => advance(o, status)}>{label}</GhostBtn>
                        ))}
                        {!NEXT_ACTIONS[o.status] && <span className="text-xs text-stone-300">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && orders.length === 0 && <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-stone-400">No orders yet.</td></tr>}
                {loading && <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-stone-400">Loading…</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {creating && <NewOrderModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); }} />}
    </div>
  );
};

const NewOrderModal = ({ onClose, onDone }) => {
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [channel, setChannel] = useState('offline');
  const [lines, setLines] = useState([{ productId: '', qty: '' }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSellerCustomers().then((r) => setCustomers(listOf(r))).catch(() => {});
    getSellerProducts().then((r) => setProducts(listOf(r))).catch(() => {});
  }, []);

  const setLine = (i, k, v) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const submit = async () => {
    const items = lines.filter((l) => l.productId && Number(l.qty) > 0).map((l) => ({ productId: l.productId, qty: Number(l.qty) }));
    if (!items.length) return toast('error', 'Add at least one product');
    setBusy(true);
    try {
      const r = await createSellerOrder({ customerId: customerId || undefined, items, channel, salesChannel: 'manual' });
      toast('success', r?.message || 'Order created');
      onDone();
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  return (
    <Modal title="New Order" onClose={onClose} wide>
      <p className="text-xs text-stone-400 mb-2">Reserves your stock FEFO and assigns an invoice number. Ship later to deduct stock and mark units sold.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Buyer (customer / dealer)">
          <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Walk-in (no buyer)</option>
            {customers.map((c) => <option key={c._id} value={c._id}>{c.name}{c.type === 'dealer' ? ' · Dealer' : ''}</option>)}
          </select>
        </Field>
        <Field label="Channel"><select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="offline">Offline</option><option value="online">Online</option></select></Field>
      </div>
      <p className="text-xs font-bold text-stone-500 mt-2 mb-1">Products</p>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1">
              <select className={inputCls} value={l.productId} onChange={(e) => setLine(i, 'productId', e.target.value)}>
                <option value="">Select product…</option>
                {products.map((p) => <option key={p._id} value={p._id}>{p.productName}{p.mrp ? ` · ₹${p.mrp}` : ''}</option>)}
              </select>
            </div>
            <input type="number" min="1" placeholder="Qty" className={`${inputCls} w-24`} value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} />
            {lines.length > 1 && <GhostBtn onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>✕</GhostBtn>}
          </div>
        ))}
        <GhostBtn onClick={() => setLines((ls) => [...ls, { productId: '', qty: '' }])}>+ Add product</GhostBtn>
      </div>
      <div className="mt-3"><PrimaryBtn disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create Order & Invoice'}</PrimaryBtn></div>
    </Modal>
  );
};

export default SellerOutbound;
