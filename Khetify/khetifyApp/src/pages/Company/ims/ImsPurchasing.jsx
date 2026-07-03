import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { useSubscription, FEATURES } from '../../../context/SubscriptionContext';
import {
  getVendors, createVendor, getPurchaseOrders, createPurchaseOrder, updatePurchaseOrderStatus,
  formatINR, fmtDate,
} from '../../../lib/imsApi';
import { Modal, Field, inputCls, PrimaryBtn, GhostBtn, Th } from './ImsUi';

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) =>
  toast('error', err?.response?.data?.message || err.message || 'Something went wrong');

const PO_STATUS = {
  draft: 'bg-stone-100 text-stone-600',
  sent: 'bg-orange-50 text-orange-600',
  received: 'bg-green-50 text-green-600',
  cancelled: 'bg-red-50 text-red-600',
};
const PO_NEXT = { draft: ['sent', 'cancelled'], sent: ['received', 'cancelled'], received: [], cancelled: [] };

/** Purchasing — vendors + purchase orders. Premium (supply_workflow). */
const ImsPurchasing = () => {
  const navigate = useNavigate();
  const { has, loading: subLoading } = useSubscription();
  const allowed = has(FEATURES.SUPPLY_WORKFLOW);

  useEffect(() => { if (!subLoading && !allowed) navigate('/billing', { replace: true }); }, [subLoading, allowed, navigate]);

  const [tab, setTab] = useState('orders');
  const [vendors, setVendors] = useState([]);
  const [pos, setPos] = useState([]);
  const [modal, setModal] = useState(null); // 'vendor' | 'po'

  const refresh = () => {
    getVendors().then((r) => r?.success && setVendors(r.data)).catch(() => {});
    getPurchaseOrders().then((r) => r?.success && setPos(r.data)).catch(() => {});
  };
  useEffect(() => { if (allowed) refresh(); }, [allowed]);

  const advance = async (id, status) => {
    try { await updatePurchaseOrderStatus(id, status); toast('success', `PO marked ${status}`); refresh(); }
    catch (err) { apiError(err); }
  };

  if (subLoading || !allowed) return null;

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {[['orders', 'Purchase Orders'], ['vendors', 'Vendors']].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`text-xs font-bold px-4 py-2 rounded-full border transition-colors ${tab === k ? 'bg-[#EA2831] border-[#EA2831] text-white' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'orders'
            ? <PrimaryBtn onClick={() => setModal('po')}><span className="material-symbols-outlined text-base">add</span> New PO</PrimaryBtn>
            : <PrimaryBtn onClick={() => setModal('vendor')}><span className="material-symbols-outlined text-base">add_business</span> Add Vendor</PrimaryBtn>}
        </div>

        {tab === 'orders' ? (
          <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full text-left border-collapse min-w-[860px] resp-table">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200">
                    <Th>PO</Th><Th>Vendor</Th><Th>Items</Th><Th>Amount</Th><Th>Expected</Th><Th>Status</Th><Th right>Action</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {pos.map((po) => (
                    <tr key={po._id} className="hover:bg-stone-50/30">
                      <td data-label="PO" className="px-6 py-4 text-sm font-bold text-stone-900">{po.poNumber}</td>
                      <td data-label="Vendor" className="px-6 py-4 text-sm text-stone-600">{po.vendorId?.name || '—'}</td>
                      <td data-label="Items" className="px-6 py-4 text-sm text-stone-500">{(po.items || []).length} line(s)</td>
                      <td data-label="Amount" className="px-6 py-4 text-sm font-bold text-stone-900">{formatINR(po.totalAmount)}</td>
                      <td data-label="Expected" className="px-6 py-4 text-sm text-stone-500">{po.expectedDate ? fmtDate(po.expectedDate) : '—'}</td>
                      <td data-label="Status" className="px-6 py-4"><span className={`text-xs font-bold px-2.5 py-1 rounded-full ${PO_STATUS[po.status]}`}>{po.status}</span></td>
                      <td className="px-6 py-4 cell-actions">
                        <div className="flex items-center justify-end gap-2">
                          {(PO_NEXT[po.status] || []).map((s) => (
                            <GhostBtn key={s} onClick={() => advance(po._id, s)}>{s === 'sent' ? 'Send' : s === 'received' ? 'Receive' : 'Cancel'}</GhostBtn>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pos.length === 0 && <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-stone-400">No purchase orders yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {vendors.map((v) => (
              <div key={v._id} className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <h3 className="font-bold text-stone-900">{v.name}</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${v.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-stone-100 text-stone-400'}`}>{v.status}</span>
                </div>
                <p className="text-xs text-stone-500 mt-1">{v.contactPerson || '—'}{v.phone ? ` · ${v.phone}` : ''}</p>
                <p className="text-xs text-stone-400 mt-2">{v.gstin ? `GSTIN ${v.gstin}` : ''}</p>
                <p className="text-xs text-stone-400">{v.address || ''}</p>
              </div>
            ))}
            {vendors.length === 0 && <p className="text-sm text-stone-400 col-span-full py-10 text-center">No vendors yet — add your first.</p>}
          </div>
        )}
      </div>

      {modal === 'vendor' && <VendorModal onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === 'po' && <POModal vendors={vendors} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    </div>
  );
};

const VendorModal = ({ onClose, onDone }) => {
  const [f, setF] = useState({ name: '', contactPerson: '', phone: '', email: '', gstin: '', address: '' });
  const u = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    try { await createVendor(f); toast('success', 'Vendor added'); onDone(); } catch (err) { apiError(err); }
  };
  return (
    <Modal title="Add Vendor" onClose={onClose} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Name *"><input className={inputCls} value={f.name} onChange={u('name')} /></Field>
        <Field label="Contact Person"><input className={inputCls} value={f.contactPerson} onChange={u('contactPerson')} /></Field>
        <Field label="Phone"><input className={inputCls} value={f.phone} onChange={u('phone')} /></Field>
        <Field label="Email"><input className={inputCls} value={f.email} onChange={u('email')} /></Field>
        <Field label="GSTIN"><input className={inputCls} value={f.gstin} onChange={u('gstin')} /></Field>
        <Field label="Address"><input className={inputCls} value={f.address} onChange={u('address')} /></Field>
      </div>
      <PrimaryBtn disabled={!f.name} onClick={submit}><span className="material-symbols-outlined text-base">add_business</span> Add Vendor</PrimaryBtn>
    </Modal>
  );
};

const POModal = ({ vendors, onClose, onDone }) => {
  const [vendorId, setVendorId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [items, setItems] = useState([{ name: '', qty: '', price: '' }]);

  const setItem = (i, k, v) => setItems(items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const addItem = () => setItems([...items, { name: '', qty: '', price: '' }]);
  const total = useMemo(() => items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0), [items]);

  const submit = async () => {
    const clean = items.filter((it) => it.name && it.qty).map((it) => ({ name: it.name, qty: Number(it.qty), price: Number(it.price) || 0 }));
    if (!vendorId || clean.length === 0) return toast('error', 'Pick a vendor and add at least one item');
    try { await createPurchaseOrder({ vendorId, items: clean, expectedDate: expectedDate || null }); toast('success', 'PO created'); onDone(); }
    catch (err) { apiError(err); }
  };

  return (
    <Modal title="New Purchase Order" onClose={onClose} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Vendor *">
          <select className={inputCls} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Select vendor…</option>
            {vendors.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
          </select>
        </Field>
        <Field label="Expected Date"><input type="date" className={inputCls} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></Field>
      </div>

      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">Items</p>
      <div className="space-y-2 mb-3">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <input className={`${inputCls} col-span-6`} placeholder="Item" value={it.name} onChange={(e) => setItem(i, 'name', e.target.value)} />
            <input className={`${inputCls} col-span-3`} type="number" placeholder="Qty" value={it.qty} onChange={(e) => setItem(i, 'qty', e.target.value)} />
            <input className={`${inputCls} col-span-3`} type="number" placeholder="Price" value={it.price} onChange={(e) => setItem(i, 'price', e.target.value)} />
          </div>
        ))}
      </div>
      <button onClick={addItem} className="text-xs font-bold text-[#EA2831] mb-4">+ Add item</button>

      <div className="flex items-center justify-between border-t border-stone-100 pt-4">
        <span className="text-sm font-bold text-stone-900">Total: {formatINR(total)}</span>
        <PrimaryBtn disabled={!vendorId} onClick={submit}><span className="material-symbols-outlined text-base">receipt_long</span> Create PO</PrimaryBtn>
      </div>
    </Modal>
  );
};

export default ImsPurchasing;
