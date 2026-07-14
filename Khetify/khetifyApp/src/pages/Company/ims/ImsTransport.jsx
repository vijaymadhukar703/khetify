import React, { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import {
  getTmsShipments, createTmsShipment, approveShipment, dispatchShipment, deliverShipment, getDiscrepancies,
  getVehicles, createVehicle, getDrivers, createDriver, getWarehouses, getWarehouseDirectory, getLots, getProducts, fmtDate,
  getTransferRequests, createTransferRequest, acceptTransferRequest, rejectTransferRequest,
} from '../../../lib/imsApi';
import { usePermission } from '../../../context/PermissionContext';
import { Modal, Field, inputCls, PrimaryBtn, GhostBtn, Th } from './ImsUi';
import { ManifestModal, ReceiveModal } from '../../../Components/ims/TransferModals';
import { movementKind } from '../../../lib/movementLabel';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);

const STATUS_STYLES = {
  draft: 'bg-stone-100 text-stone-500', planned: 'bg-blue-50 text-blue-600', approved: 'bg-indigo-50 text-indigo-600', in_transit: 'bg-orange-50 text-orange-600',
  arrived: 'bg-amber-50 text-amber-600', verifying: 'bg-amber-50 text-amber-600', delivered: 'bg-green-50 text-green-600',
  partially_received: 'bg-amber-50 text-amber-700', received: 'bg-green-50 text-green-600',
  exception: 'bg-red-50 text-red-700', cancelled: 'bg-stone-100 text-stone-400', pending: 'bg-stone-100 text-stone-500',
};

const getPos = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve({});
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => resolve({}), { timeout: 5000 }
  );
});

const ImsTransport = () => {
  const [tab, setTab] = useState('shipments');
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-1 border-b border-stone-200">
          {[['shipments', 'Shipments'], ['requests', 'Requests'], ['vehicles', 'Vehicles'], ['drivers', 'Drivers'], ['exceptions', 'Exceptions']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px ${tab === k ? 'border-[#EA2831] text-[#EA2831]' : 'border-transparent text-stone-400 hover:text-stone-700'}`}>{l}</button>
          ))}
        </div>
        {tab === 'shipments' && <ShipmentsTab />}
        {tab === 'requests' && <RequestsTab />}
        {tab === 'vehicles' && <VehiclesTab />}
        {tab === 'drivers' && <DriversTab />}
        {tab === 'exceptions' && <ExceptionsTab />}
      </div>
    </div>
  );
};

/* ───────────── Shipments ───────────── */
const ShipmentsTab = () => {
  const [rows, setRows] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [manifestInfo, setManifestInfo] = useState(null);
  const [verify, setVerify] = useState(null);
  const [view, setView] = useState('all'); // all | incoming
  // Warehouse-level access: the backend already scopes this list to the
  // user's assigned warehouses; warehouseIds drives the Incoming filter.
  const { warehouseIds, can } = usePermission();
  // company_admin is denied inventory:transfer (view-only on transfers), so the
  // transfer-initiation controls (warehouse New Shipment, dispatching a
  // transfer) are hidden from them; operations managers keep them.
  const canTransfer = can('inventory:transfer');
  const refresh = () => getTmsShipments().then((r) => setRows(listOf(r))).catch(apiError);
  useEffect(() => { refresh(); }, []);

  const isIncoming = (s) =>
    s.toType === 'warehouse' &&
    ['in_transit', 'arrived', 'verifying'].includes(s.status) &&
    (!warehouseIds?.length || warehouseIds.includes(String(s.toWarehouseId?._id || s.toWarehouseId)));
  // direction checks: only the SOURCE side approves/dispatches, only the
  // DESTINATION side receives (admin/unscoped users pass both).
  const isMyOutgoing = (s) =>
    !warehouseIds?.length || !s.fromWarehouseId || warehouseIds.includes(String(s.fromWarehouseId?._id || s.fromWarehouseId));
  const visible = view === 'incoming' ? rows.filter(isIncoming) : rows;
  const incomingCount = rows.filter(isIncoming).length;

  const doApprove = async (s) => {
    try { await approveShipment(s._id); toast('success', 'Shipment approved'); refresh(); } catch (err) { apiError(err); }
  };
  const doDispatch = async (s) => {
    try { const r = await dispatchShipment(s._id, await getPos()); setManifestInfo(r?.data || r); refresh(); } catch (err) { apiError(err); }
  };
  const doDeliver = async (s) => {
    const { value: signedBy } = await Swal.fire({ title: 'Mark delivered', input: 'text', inputLabel: 'Received by (name)', showCancelButton: true });
    if (!signedBy) return;
    try { await deliverShipment(s._id, { signedBy, ...(await getPos()) }); toast('success', 'Delivered'); refresh(); } catch (err) { apiError(err); }
  };

  return (
    <>
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          {[['all', `All (${rows.length})`], ['incoming', `Incoming Transfers (${incomingCount})`]].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${view === k ? 'bg-[#EA2831] border-[#EA2831] text-white' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}>
              {l}
            </button>
          ))}
        </div>
        <PrimaryBtn onClick={() => setShowNew(true)}><span className="material-symbols-outlined text-base">local_shipping</span> New Shipment</PrimaryBtn>
      </div>
      <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
        <table className="w-full text-left border-collapse resp-table">
          <thead><tr className="bg-stone-50 border-b border-stone-200"><Th compact>To</Th><Th compact>Type</Th><Th compact>Vehicle</Th><Th compact>Driver</Th><Th compact>Phone</Th><Th compact>Status</Th><Th compact>Dispatched</Th><Th right compact>Actions</Th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {visible.map((s) => (
              <tr key={s._id} className="hover:bg-stone-50/40">
                <td className="px-3 py-3 text-sm font-bold text-stone-900" data-label="To">{s.toLabel}</td>
                <td className="px-3 py-3 text-xs text-stone-500" data-label="Type">{movementKind(s)}</td>
                <td className="px-3 py-3 text-xs text-stone-500" data-label="Vehicle">{s.vehicleId?.regNo || s.vehicleNo || '—'}</td>
                <td className="px-3 py-3 text-xs text-stone-500" data-label="Driver">{s.driverId?.name || s.driverName || '—'}</td>
                <td className="px-3 py-3 text-xs text-stone-500" data-label="Phone">{s.driverId?.phone || s.driverPhone || '—'}</td>
                <td className="px-3 py-3" data-label="Status"><span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_STYLES[s.status] || 'bg-stone-100'}`}>{s.status}</span></td>
                <td className="px-3 py-3 text-xs text-stone-500" data-label="Dispatched">{s.dispatchedAt ? fmtDate(s.dispatchedAt) : '—'}</td>
                <td className="px-3 py-3 cell-actions">
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {/* Transfers skip the separate Approve step — Dispatch
                        accepts a planned shipment directly. Approve stays for
                        other shipment types. */}
                    {s.refType !== 'Transfer' && ['draft', 'planned'].includes(s.status) && isMyOutgoing(s) && <GhostBtn sm onClick={() => doApprove(s)}>Approve</GhostBtn>}
                    {['draft', 'planned', 'approved', 'loading'].includes(s.status) && isMyOutgoing(s) && (s.refType !== 'Transfer' || canTransfer) && <GhostBtn sm onClick={() => doDispatch(s)}>Dispatch</GhostBtn>}
                    {/* Sender can re-open the shipping label (QR + barcode) any
                        time after dispatch to print/share it. It is a SENDER-only
                        control: never shown on the destination's receivable row
                        (so it never appears alongside "Receive Lot"). */}
                    {s.qrToken && isMyOutgoing(s) && !isIncoming(s) && (
                      <GhostBtn sm onClick={() => setManifestInfo({ qrPayload: `${s._id}.${s.qrToken}` })}>
                        <span className="material-symbols-outlined text-sm">qr_code_2</span> Label
                      </GhostBtn>
                    )}
                    {/* Receive only renders for the DESTINATION warehouse's team
                        (the sender sees the row but cannot receive their own
                        outbound transfer — the backend enforces this too). */}
                    {isIncoming(s) && <GhostBtn sm onClick={() => setVerify(s)}>Receive</GhostBtn>}
                    {['in_transit', 'arrived'].includes(s.status) && s.toType === 'customer' && <GhostBtn sm onClick={() => doDeliver(s)}>Deliver</GhostBtn>}
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={8} className="px-6 py-12 text-center text-sm text-stone-400">{view === 'incoming' ? 'No incoming transfers for your warehouse.' : 'No shipments yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {showNew && <NewShipmentModal canTransfer={canTransfer} onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); refresh(); }} />}
      {manifestInfo && <ManifestModal info={manifestInfo} onClose={() => setManifestInfo(null)} />}
      {verify && <ReceiveModal shipment={verify} onClose={() => setVerify(null)} onDone={() => { setVerify(null); refresh(); }} />}
    </>
  );
};

const NewShipmentModal = ({ canTransfer = true, onClose, onDone }) => {
  const [warehouses, setWarehouses] = useState([]);
  // Destination picker uses the full company directory; the FROM picker stays
  // on the caller's scoped list (you dispatch from YOUR warehouse).
  const [warehouseDir, setWarehouseDir] = useState([]);
  const [lots, setLots] = useState([]);
  // Without transfer rights (e.g. company_admin) only customer/manual shipments
  // can be created — the warehouse-transfer option is hidden and never default.
  const [f, setF] = useState({ toType: canTransfer ? 'warehouse' : 'customer', fromWarehouseId: '', toWarehouseId: '', toLabel: '', vehicleNo: '', driverName: '', driverPhone: '' });
  const [lines, setLines] = useState([{ inventoryId: '', qty: '' }]);
  const [phoneErr, setPhoneErr] = useState('');
  useEffect(() => {
    getWarehouses().then((r) => setWarehouses(listOf(r))).catch(() => {});
    getWarehouseDirectory().then((r) => setWarehouseDir(Array.isArray(r) ? r : r?.data || [])).catch(() => {});
    getLots().then((r) => setLots(listOf(r))).catch(() => {});
  }, []);
  const submit = async () => {
    // Driver phone must be a valid 10-digit mobile number.
    if (!/^\d{10}$/.test(f.driverPhone.trim())) {
      setPhoneErr('Enter a valid 10-digit driver phone number');
      return;
    }
    setPhoneErr('');
    try {
      const body = { toType: f.toType, toLabel: f.toLabel || (f.toType === 'warehouse' ? 'Warehouse transfer' : 'Customer'), fromWarehouseId: f.fromWarehouseId || undefined, vehicleNo: f.vehicleNo, driverName: f.driverName, driverPhone: f.driverPhone.trim() };
      if (f.toType === 'warehouse') {
        body.toWarehouseId = f.toWarehouseId;
        body.lines = lines.filter((l) => l.inventoryId && l.qty).map((l) => ({ inventoryId: l.inventoryId, qty: Number(l.qty) }));
      }
      await createTmsShipment(body); toast('success', 'Shipment planned'); onDone();
    } catch (err) { apiError(err); }
  };
  return (
    <Modal title="New Shipment" onClose={onClose} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Type"><select className={inputCls} value={f.toType} onChange={(e) => setF({ ...f, toType: e.target.value })}>{canTransfer && <option value="warehouse">Warehouse transfer</option>}<option value="customer">Customer / manual</option></select></Field>
        <Field label="From warehouse"><select className={inputCls} value={f.fromWarehouseId} onChange={(e) => setF({ ...f, fromWarehouseId: e.target.value })}><option value="">—</option>{warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}</select></Field>
      </div>
      {f.toType === 'warehouse' ? (
        <>
          <Field label="To warehouse *"><select className={inputCls} value={f.toWarehouseId} onChange={(e) => setF({ ...f, toWarehouseId: e.target.value })}><option value="">Select…</option>{(warehouseDir.length ? warehouseDir : warehouses).filter((w) => String(w._id) !== String(f.fromWarehouseId)).map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}</select></Field>
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">Lots to transfer</p>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  {/* Width is controlled by the WRAPPERS, not the inputs: inputCls
                      carries w-full, so putting w-24 on the input itself gets
                      overridden and the lot select collapses. The select wrapper
                      grows (flex-1 min-w-0); the Qty wrapper stays fixed (w-24). */}
                  <div className="flex-1 min-w-0">
                    <select
                      className={inputCls}
                      value={l.inventoryId}
                      onChange={(e) => setLines((ls) => ls.map((x, idx) => idx === i ? { ...x, inventoryId: e.target.value } : x))}
                    >
                      <option value="">Select lot…</option>
                      {lots.map((lot) => (
                        <option key={lot._id} value={lot._id}>
                          {(lot.productId?.productName || 'Item')} · {lot.lotNumber || lot.batchNumber} (avail {lot.availableStock})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-24 shrink-0">
                    <input
                      type="number"
                      min="1"
                      placeholder="Qty"
                      className={inputCls}
                      value={l.qty}
                      onChange={(e) => setLines((ls) => ls.map((x, idx) => idx === i ? { ...x, qty: e.target.value } : x))}
                    />
                  </div>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                      className="shrink-0 inline-flex items-center justify-center h-10 w-10 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-[#EA2831] transition-colors"
                      title="Remove lot"
                    >
                      <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
            {lots.length === 0 && (
              <p className="text-[11px] text-stone-400 mt-1.5">No lots available to transfer yet.</p>
            )}
            <GhostBtn className="mt-2" onClick={() => setLines((ls) => [...ls, { inventoryId: '', qty: '' }])}>+ Add lot</GhostBtn>
          </div>
        </>
      ) : (
        <Field label="Destination label *"><input className={inputCls} value={f.toLabel} onChange={(e) => setF({ ...f, toLabel: e.target.value })} placeholder="Customer / address" /></Field>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 mt-2">
        <Field label="Vehicle No."><input className={inputCls} value={f.vehicleNo} onChange={(e) => setF({ ...f, vehicleNo: e.target.value })} /></Field>
        <Field label="Driver"><input className={inputCls} value={f.driverName} onChange={(e) => setF({ ...f, driverName: e.target.value })} /></Field>
        <Field label="Driver phone" required>
          <input
            className={inputCls}
            type="tel"
            inputMode="numeric"
            maxLength={10}
            placeholder="10-digit number"
            value={f.driverPhone}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
              setF({ ...f, driverPhone: digits });
              if (phoneErr) setPhoneErr('');
            }}
          />
          {phoneErr && <p className="text-xs font-medium text-[#EA2831] mt-1">⚠ {phoneErr}</p>}
        </Field>
      </div>
      <div className="mt-3"><PrimaryBtn onClick={submit}>Plan Shipment</PrimaryBtn></div>
    </Modal>
  );
};

/* ───────────── Stock Requests (B asks A) ───────────── */
const REQ_STATUS_STYLES = {
  requested: 'bg-amber-50 text-amber-600', accepted: 'bg-green-50 text-green-600',
  rejected: 'bg-red-50 text-red-600', fulfilled: 'bg-blue-50 text-blue-600', cancelled: 'bg-stone-100 text-stone-400',
};

/**
 * Inter-warehouse stock requests. A destination warehouse asks a source
 * warehouse for stock; the source's operations manager sees the request here
 * and accepts/rejects it; the requester sees the decision (acknowledgment);
 * the company admin is notified of every step.
 */
const RequestsTab = () => {
  const [rows, setRows] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const { warehouseIds, can } = usePermission();
  // Accepting a request creates a transfer shipment → needs inventory:transfer.
  // Admins (denied) can see + reject requests but not accept them.
  const canTransfer = can('inventory:transfer');
  const refresh = () => getTransferRequests().then((r) => setRows(listOf(r))).catch(apiError);
  useEffect(() => { refresh(); }, []);

  const mine = (whId) => !warehouseIds?.length || warehouseIds.includes(String(whId?._id || whId));
  const decide = async (id, ok) => {
    try {
      // Accept runs a server-side stock check: if the source warehouse lacks
      // the quantity, a 409 alert explains how much is available and what to
      // do (restock and accept later, or reject with a note) — apiError
      // surfaces that message. On success a linked FEFO shipment is created.
      const r = await (ok ? acceptTransferRequest(id) : rejectTransferRequest(id));
      toast('success', r?.message || (ok ? 'Request accepted — the requester has been notified' : 'Request rejected'));
      refresh();
    } catch (err) { apiError(err); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{rows.length} request(s)</p>
        <PrimaryBtn onClick={() => setShowNew(true)}>
          <span className="material-symbols-outlined text-base">move_down</span> Request Stock
        </PrimaryBtn>
      </div>
      <div className="border border-stone-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[760px] resp-table">
          <thead><tr className="text-[10px] uppercase text-stone-400 bg-stone-50"><Th>Product</Th><Th right>Qty</Th><Th>From (source)</Th><Th>For (requester)</Th><Th>Status</Th><Th>Requested</Th><Th right>Actions</Th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r) => (
              <tr key={r._id} className="hover:bg-stone-50/40">
                <td className="px-4 py-3 text-sm font-bold" data-label="Product">{r.productId?.productName || '—'}</td>
                <td className="px-4 py-3 text-sm text-right" data-label="Qty">{r.qty}</td>
                <td className="px-4 py-3 text-sm" data-label="From (source)">{r.fromWarehouseId?.name || '—'}</td>
                <td className="px-4 py-3 text-sm" data-label="For (requester)">{r.toWarehouseId?.name || '—'}{r.requestedBy?.name ? <span className="text-xs text-stone-400"> · {r.requestedBy.name}</span> : null}</td>
                <td className="px-4 py-3" data-label="Status"><span className={`text-xs font-bold px-2.5 py-1 rounded-full ${REQ_STATUS_STYLES[r.status] || 'bg-stone-100 text-stone-500'}`}>{r.status}</span></td>
                <td className="px-4 py-3 text-xs text-stone-400" data-label="Requested">{fmtDate(r.createdAt)}</td>
                <td className="px-4 py-3 cell-actions">
                  <div className="flex items-center justify-end gap-2">
                    {r.status === 'requested' && mine(r.fromWarehouseId) && (
                      canTransfer ? (
                        <>
                          <GhostBtn onClick={() => decide(r._id, true)}>Accept</GhostBtn>
                          <GhostBtn onClick={() => decide(r._id, false)}>Reject</GhostBtn>
                        </>
                      ) : (
                        <span className="text-[11px] font-bold text-stone-400">Awaiting source warehouse</span>
                      )
                    )}
                    {r.status === 'accepted' && (
                      <span className="text-[11px] font-bold text-green-600">
                        ✓ Accepted{r.decidedBy?.name ? ` by ${r.decidedBy.name}` : ''}{r.shipmentId ? ' · shipment created' : ''}
                      </span>
                    )}
                    {r.status === 'fulfilled' && (
                      <span className="text-[11px] font-bold text-blue-600">✓ Delivered &amp; received</span>
                    )}
                    {r.status === 'rejected' && mine(r.toWarehouseId) && (
                      <span className="text-[11px] font-bold text-red-600">✕ Rejected</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-stone-400">No stock requests yet. Use "Request Stock" to ask another warehouse for inventory.</td></tr>}
          </tbody>
        </table>
      </div>
      {showNew && <NewRequestModal onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); refresh(); toast('success', 'Request sent — the source warehouse and admin have been notified'); }} />}
    </div>
  );
};

const NewRequestModal = ({ onClose, onDone }) => {
  const [products, setProducts] = useState([]);
  const [dir, setDir] = useState([]);
  const { warehouseIds } = usePermission();
  const [f, setF] = useState({ productId: '', fromWarehouseId: '', toWarehouseId: '', qty: '', note: '' });
  useEffect(() => {
    getProducts().then((r) => setProducts(r?.data || r?.products || [])).catch(() => {});
    getWarehouseDirectory().then((r) => setDir(Array.isArray(r) ? r : r?.data || [])).catch(() => {});
  }, []);
  const scoped = !!warehouseIds?.length;
  // a scoped manager requests FOR their own warehouse; sources are everyone else
  const sources = dir.filter((w) => (scoped ? !warehouseIds.includes(String(w._id)) : String(w._id) !== String(f.toWarehouseId)));
  const submit = async () => {
    try {
      await createTransferRequest({
        productId: f.productId, fromWarehouseId: f.fromWarehouseId,
        ...(!scoped && { toWarehouseId: f.toWarehouseId }),
        qty: Number(f.qty), ...(f.note && { note: f.note }),
      });
      onDone();
    } catch (err) { apiError(err); }
  };
  return (
    <Modal title="Request Stock from Another Warehouse" onClose={onClose}>
      <Field label="Product *">
        <select className={inputCls} value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
          <option value="">Select product…</option>
          {products.map((p) => <option key={p._id} value={p._id}>{p.productName}</option>)}
        </select>
      </Field>
      {!scoped && (
        <Field label="Requesting warehouse (needs the stock) *">
          <select className={inputCls} value={f.toWarehouseId} onChange={(e) => setF({ ...f, toWarehouseId: e.target.value })}>
            <option value="">Select…</option>
            {dir.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Source warehouse (has the stock) *">
        <select className={inputCls} value={f.fromWarehouseId} onChange={(e) => setF({ ...f, fromWarehouseId: e.target.value })}>
          <option value="">Select…</option>
          {sources.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
        </select>
      </Field>
      <Field label="Quantity *"><input type="number" min="1" className={inputCls} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
      <Field label="Note"><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="optional" /></Field>
      <PrimaryBtn disabled={!f.productId || !f.fromWarehouseId || !f.qty || (!scoped && !f.toWarehouseId)} onClick={submit}>
        <span className="material-symbols-outlined text-base">send</span> Send Request
      </PrimaryBtn>
    </Modal>
  );
};

/* ───────────── Vehicles ───────────── */
const VehiclesTab = () => {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ regNo: '', type: '', capacityKg: '' });
  const refresh = () => getVehicles().then((r) => setRows(listOf(r))).catch(apiError);
  useEffect(() => { refresh(); }, []);
  const add = async () => { try { await createVehicle({ regNo: f.regNo, type: f.type, capacityKg: f.capacityKg ? Number(f.capacityKg) : undefined }); setF({ regNo: '', type: '', capacityKg: '' }); refresh(); } catch (err) { apiError(err); } };
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <Field label="Reg No."><input className={inputCls} value={f.regNo} onChange={(e) => setF({ ...f, regNo: e.target.value })} placeholder="MP20 GA 1234" /></Field>
        <Field label="Type"><input className={inputCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} placeholder="truck" /></Field>
        <Field label="Capacity (kg)"><input type="number" className={inputCls} value={f.capacityKg} onChange={(e) => setF({ ...f, capacityKg: e.target.value })} /></Field>
        <PrimaryBtn disabled={!f.regNo} onClick={add}>Add</PrimaryBtn>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {rows.map((v) => (
          <div key={v._id} className="border border-stone-200 rounded-xl p-4">
            <p className="font-bold">{v.regNo}</p>
            <p className="text-xs text-stone-400">{v.type || '—'} · {v.capacityKg || '?'} kg · {v.status}</p>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-stone-400 col-span-full">No vehicles yet.</p>}
      </div>
    </div>
  );
};

/* ───────────── Drivers ───────────── */
const DriversTab = () => {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ name: '', phone: '', pin: '', licenseNo: '' });
  const refresh = () => getDrivers().then((r) => setRows(listOf(r))).catch(apiError);
  useEffect(() => { refresh(); }, []);
  const add = async () => { try { await createDriver(f); toast('success', 'Driver added'); setF({ name: '', phone: '', pin: '', licenseNo: '' }); refresh(); } catch (err) { apiError(err); } };
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2 flex-wrap">
        <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Phone"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="PIN"><input className={inputCls} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} placeholder="4-8 digits" /></Field>
        <Field label="Licence No."><input className={inputCls} value={f.licenseNo} onChange={(e) => setF({ ...f, licenseNo: e.target.value })} /></Field>
        <PrimaryBtn disabled={!f.name || !f.phone || !f.pin} onClick={add}>Add Driver</PrimaryBtn>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {rows.map((d) => (
          <div key={d._id} className="border border-stone-200 rounded-xl p-4">
            <p className="font-bold">{d.userId?.name}</p>
            <p className="text-xs text-stone-400">{d.phone} · {d.vehicleId?.regNo || 'no vehicle'} · {d.licenseNo || 'no licence'}</p>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-stone-400 col-span-full">No drivers yet.</p>}
      </div>
      <p className="text-[11px] text-stone-400">Drivers log in at <span className="font-mono">/driver</span> with phone + PIN.</p>
    </div>
  );
};

/* ───────────── Exceptions ───────────── */
const ExceptionsTab = () => {
  const [rows, setRows] = useState([]);
  useEffect(() => { getDiscrepancies().then((r) => setRows(listOf(r))).catch(apiError); }, []);
  return (
    <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
      <table className="w-full text-left border-collapse min-w-[640px] resp-table">
        <thead><tr className="bg-stone-50 border-b border-stone-200"><Th>Shipment</Th><Th>Product</Th><Th>Expected</Th><Th>Received</Th><Th>Short</Th><Th>Status</Th></tr></thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((d) => (
            <tr key={d._id}>
              <td className="px-6 py-4 text-sm text-stone-500" data-label="Shipment">{d.shipmentId?.toLabel || '—'}</td>
              <td className="px-6 py-4 text-sm font-bold" data-label="Product">{d.productId?.productName || '—'}</td>
              <td className="px-6 py-4 text-sm" data-label="Expected">{d.expectedQty}</td>
              <td className="px-6 py-4 text-sm" data-label="Received">{d.receivedQty}</td>
              <td className="px-6 py-4 text-sm text-red-600 font-bold" data-label="Short">{d.shortageQty}</td>
              <td className="px-6 py-4" data-label="Status"><span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-600">{d.status}</span></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-stone-400">No open discrepancies.</td></tr>}
        </tbody>
      </table>
    </div>
  );
};

export default ImsTransport;
