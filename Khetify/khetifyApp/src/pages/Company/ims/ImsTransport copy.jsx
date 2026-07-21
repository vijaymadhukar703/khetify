import React, { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import {
  getTmsShipments, createTmsShipment, approveShipment, dispatchShipment, deliverShipment, getDiscrepancies,
  getVehicles, createVehicle, getDrivers, createDriver, getWarehouses, getWarehouseDirectory, getLots, getProducts, fmtDate,
  getTransferRequests, createTransferRequest, acceptTransferRequest, rejectTransferRequest,
} from '../../../lib/imsApi';
import { usePermission } from '../../../context/PermissionContext';
import { WAREHOUSE_ROLES } from '../../../lib/roles';
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

// Fleet admin (Vehicles / Drivers) and Exceptions are centrally managed, so
// neither the MAIN COMPANY nor the COMPANY WAREHOUSE gets those tabs — both see
// the shipment views only. Every other role keeps the full set. Nothing is
// removed globally: the tab components, routes and APIs are untouched.
const ALL_TABS = [
  ['shipments', 'Shipments'], ['requests', 'Requests'],
  ['vehicles', 'Vehicles'], ['drivers', 'Drivers'], ['exceptions', 'Exceptions'],
];
const SHIPMENT_TABS = ['shipments', 'requests'];

const ImsTransport = () => {
  const { role } = usePermission();
  const restricted = role === 'company_admin' || WAREHOUSE_ROLES.has(role);
  const tabs = restricted ? ALL_TABS.filter(([k]) => SHIPMENT_TABS.includes(k)) : ALL_TABS;

  const [tab, setTab] = useState('shipments');
  // Never render a tab this role can't see (e.g. state left over from a role
  // switch) — fall back to the first allowed one.
  const active = tabs.some(([k]) => k === tab) ? tab : tabs[0][0];

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-1 border-b border-stone-200">
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px ${active === k ? 'border-[#EA2831] text-[#EA2831]' : 'border-transparent text-stone-400 hover:text-stone-700'}`}>{l}</button>
          ))}
        </div>
        {active === 'shipments' && <ShipmentsTab />}
        {active === 'requests' && <RequestsTab />}
        {active === 'vehicles' && <VehiclesTab />}
        {active === 'drivers' && <DriversTab />}
        {active === 'exceptions' && <ExceptionsTab />}
      </div>
    </div>
  );
};

/* ───────────── Shipments ───────────── */
/**
 * Which business flow raised this shipment — a small hint under the reference,
 * read from the shipment's OWN refType/toType (already on the payload). Purely
 * additive context; the Type column keeps showing Transfer/Sales as before.
 */
const sourceLabelOf = (s) => {
  if (s.refType === 'TransferRequest' || s.refType === 'Transfer') return 'Warehouse Transfer';
  if (s.refType === 'SupplyOrder') return s.toType === 'seller' ? 'Seller Supply' : 'Supply Request';
  if (s.toType === 'seller') return 'Seller Supply';
  return null;
};

const ShipmentsTab = () => {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [manifestInfo, setManifestInfo] = useState(null);
  const [verify, setVerify] = useState(null);
  const [view, setView] = useState('all'); // all | incoming
  // Warehouse-level access: the backend already scopes this list to the
  // user's assigned warehouses; warehouseIds drives the Incoming filter.
  const { warehouseIds, can, role } = usePermission();
  const isMainCompany = role === 'company_admin';
  const isWarehouse = WAREHOUSE_ROLES.has(role);
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

  // A warehouse-scoped user (Yogesh/Indore, Karan/Bhopal) needs to know which
  // way a shipment is moving relative to THEIR warehouse — "To: Bhopal" alone
  // doesn't tell Karan it's arriving. The main Company is unscoped, so it reads
  // From → To and gets no badge. Compared by ID, never by name.
  const mine = (warehouseIds || []).map(String);
  const scoped = mine.length > 0;
  const directionOf = (s) => {
    if (!scoped) return null;
    if (mine.includes(String(s.fromWarehouseId?._id || s.fromWarehouseId))) return 'Outgoing';
    if (mine.includes(String(s.toWarehouseId?._id || s.toWarehouseId))) return 'Incoming';
    return null;
  };

  // The direction FILTERS count by direction alone. isIncoming() above stays as
  // the Receive Lot action gate — it also demands a receivable status
  // (in_transit/arrived/verifying), which is exactly why the old count read
  // "Incoming Transfers (0)" while incoming rows sat on screen.
  const incomingRows = isWarehouse ? rows.filter((s) => directionOf(s) === 'Incoming') : rows.filter(isIncoming);
  const outgoingRows = rows.filter((s) => directionOf(s) === 'Outgoing');
  const views = isMainCompany
    ? [['all', `All (${rows.length})`]]
    : isWarehouse
      ? [['all', `All (${rows.length})`], ['incoming', `Incoming Transfers (${incomingRows.length})`], ['outgoing', `Outgoing Transfers (${outgoingRows.length})`]]
      : [['all', `All (${rows.length})`], ['incoming', `Incoming Transfers (${incomingRows.length})`]];
  // Guards the data too, not just the buttons — a view a role can't select can
  // never filter its table.
  const inView = isMainCompany ? rows
    : view === 'incoming' ? incomingRows
      : view === 'outgoing' && isWarehouse ? outgoingRows
        : rows;

  // Search runs AFTER the direction views, so incoming/outgoing filtering and
  // its counts are untouched — it only narrows what the chosen view already
  // holds. Case-insensitive on a copy; the stored reference is never altered.
  // Client-side by design: `ref` is derived from _id, so the server cannot index
  // or regex it without a materialised column.
  const needle = q.trim().toLowerCase();
  const visible = needle
    ? inView.filter((s) =>
        [s.ref, s.fromName, s.toName, s.vehicleId?.regNo, s.vehicleNo]
          .some((f) => (f || '').toLowerCase().includes(needle)))
    : inView;

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
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Direction views answer "what is MY warehouse sending / receiving?" —
              meaningless for the unscoped main Company (it owns every
              warehouse), so it only shows the All view. */}
          {views.map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${view === k ? 'bg-[#EA2831] border-[#EA2831] text-white' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search ref (SH-…), warehouse or vehicle…"
            className="w-56 sm:w-72 border border-stone-200 rounded-lg text-sm px-3 py-2 bg-white focus:ring-[#EA2831]"
          />
          {/* Shipments are raised by the warehouse that physically ships — the main
              Company's view is read-only oversight. Other roles keep the button. */}
          {!isMainCompany && (
            <PrimaryBtn onClick={() => setShowNew(true)}><span className="material-symbols-outlined text-base">local_shipping</span> New Shipment</PrimaryBtn>
          )}
        </div>
      </div>
      {/* The extra Ref column needs room: widen the sheet and let it scroll
          horizontally on small screens rather than clipping (the wrapper was
          overflow-hidden, which cut the table off instead of scrolling it). */}
      <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[1120px] resp-table">
          <thead><tr className="bg-stone-50 border-b border-stone-200"><Th>Shipment Ref.</Th><Th>From</Th><Th>To</Th><Th>Type</Th><Th>Vehicle</Th><Th>Status</Th><Th>Dispatched</Th><Th right>Actions</Th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {visible.map((s) => {
              const dir = directionOf(s);
              return (
              <tr key={s._id} className="hover:bg-stone-50/40">
                {/* The reference the backend derives (shipmentService.shipmentRef)
                    — the SAME value Transfer History and Supply Requests show, so
                    an operator can match a row across all three. Never rebuilt
                    here. Shown in full, no truncation. */}
                <td className="px-4 py-4" data-label="Shipment Ref.">
                  <span className="text-xs font-bold font-mono bg-stone-100 text-stone-700 px-2.5 py-1 rounded-full whitespace-nowrap">
                    {s.ref || '—'}
                  </span>
                  {sourceLabelOf(s) && (
                    <span className="block mt-1 text-[10px] font-bold uppercase tracking-wide text-stone-400">
                      {sourceLabelOf(s)}
                    </span>
                  )}
                </td>
                {/* fromName/toName are resolved server-side from the shipment's
                    warehouse RELATIONS (shipmentService.shipmentRoute) — never from
                    the *Label strings, which carry business-flow text like
                    "Warehouse (transfer)". Same resolution Transfer History uses,
                    so the two views always agree. */}
                <td className="px-6 py-4 text-sm text-stone-600" data-label="From">{s.fromName || '—'}</td>
                <td className="px-6 py-4 text-sm font-bold text-stone-900" data-label="To">
                  {s.toName || '—'}
                  {dir && (
                    <span className={`ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full align-middle ${
                      dir === 'Outgoing' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-700'
                    }`}>{dir}</span>
                  )}
                </td>
                <td className="px-6 py-4 text-xs text-stone-500" data-label="Type">{movementKind(s)}</td>
                <td className="px-6 py-4 text-xs text-stone-500" data-label="Vehicle">{s.vehicleId?.regNo || s.vehicleNo || '—'}</td>
                <td className="px-6 py-4" data-label="Status"><span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_STYLES[s.status] || 'bg-stone-100'}`}>{s.status}</span></td>
                <td className="px-6 py-4 text-xs text-stone-500" data-label="Dispatched">{s.dispatchedAt ? fmtDate(s.dispatchedAt) : '—'}</td>
                <td className="px-6 py-4 cell-actions">
                  <div className="flex items-center justify-end gap-2">
                    {/* Transfers skip the separate Approve step — Dispatch
                        accepts a planned shipment directly. Approve stays for
                        other shipment types. */}
                    {s.refType !== 'Transfer' && ['draft', 'planned'].includes(s.status) && isMyOutgoing(s) && <GhostBtn onClick={() => doApprove(s)}>Approve</GhostBtn>}
                    {['draft', 'planned', 'approved', 'loading'].includes(s.status) && isMyOutgoing(s) && (s.refType !== 'Transfer' || canTransfer) && <GhostBtn onClick={() => doDispatch(s)}>Dispatch</GhostBtn>}
                    {/* Sender can re-open the shipping label (QR + barcode) any
                        time after dispatch to print/share it. It is a SENDER-only
                        control: never shown on the destination's receivable row
                        (so it never appears alongside "Receive Lot"). */}
                    {s.qrToken && isMyOutgoing(s) && !isIncoming(s) && (
                      <GhostBtn onClick={() => setManifestInfo({ qrPayload: `${s._id}.${s.qrToken}` })}>
                        <span className="material-symbols-outlined text-sm">qr_code_2</span> Shipping Label
                      </GhostBtn>
                    )}
                    {/* Receive only renders for the DESTINATION warehouse's team
                        (the sender sees the row but cannot receive their own
                        outbound transfer — the backend enforces this too). */}
                    {isIncoming(s) && <GhostBtn onClick={() => setVerify(s)}>Receive Lot</GhostBtn>}
                    {['in_transit', 'arrived'].includes(s.status) && s.toType === 'customer' && <GhostBtn onClick={() => doDeliver(s)}>Deliver</GhostBtn>}
                  </div>
                </td>
              </tr>
              );
            })}
            {visible.length === 0 && <tr><td colSpan={8} className="px-6 py-12 text-center text-sm text-stone-400">{needle ? `No shipment matches “${q.trim()}”.` : view === 'incoming' ? 'No incoming transfers for your warehouse.' : 'No shipments yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {/* Guarded on the role too, so the modal can never be opened for the main
          Company through leftover/forced UI state — not just a hidden button. */}
      {showNew && !isMainCompany && <NewShipmentModal canTransfer={canTransfer} onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); refresh(); }} />}
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
          <p className="text-xs font-bold text-stone-500 mt-2">Lots to transfer</p>
          {lines.map((l, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1"><select className={inputCls} value={l.inventoryId} onChange={(e) => setLines((ls) => ls.map((x, idx) => idx === i ? { ...x, inventoryId: e.target.value } : x))}><option value="">Select lot…</option>{lots.map((lot) => <option key={lot._id} value={lot._id}>{(lot.productId?.productName || 'Item')} · {lot.lotNumber || lot.batchNumber} (avail {lot.availableStock})</option>)}</select></div>
              <input type="number" min="1" placeholder="Qty" className={`${inputCls} w-24`} value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, idx) => idx === i ? { ...x, qty: e.target.value } : x))} />
              {lines.length > 1 && <GhostBtn onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>✕</GhostBtn>}
            </div>
          ))}
          <GhostBtn onClick={() => setLines((ls) => [...ls, { inventoryId: '', qty: '' }])}>+ Add lot</GhostBtn>
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
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const { warehouseIds, can } = usePermission();
  // Accepting a request creates a transfer shipment → needs inventory:transfer.
  // Admins (denied) can see + reject requests but not accept them.
  const canTransfer = can('inventory:transfer');
  const refresh = () => getTransferRequests().then((r) => setRows(listOf(r))).catch(apiError);
  useEffect(() => { refresh(); }, []);

  const mine = (whId) => !warehouseIds?.length || warehouseIds.includes(String(whId?._id || whId));

  // Case-insensitive search across the transfer ref, product and both
  // warehouses, so a row can be found by the SH-… seen in Transfer History.
  // Read-only over what the API already returned — never alters the stored ref.
  const needle = q.trim().toLowerCase();
  const visible = needle
    ? rows.filter((r) =>
        [r.transferRef, r.productId?.productName, r.fromWarehouseId?.name, r.toWarehouseId?.name]
          .some((f) => (f || '').toLowerCase().includes(needle)))
    : rows;
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
      <div className="flex flex-wrap justify-between items-center gap-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{visible.length} request(s)</p>
        <div className="flex items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search ref (SH-…), product or warehouse…"
            className="w-56 sm:w-72 border border-stone-200 rounded-lg text-sm px-3 py-2 bg-white focus:ring-[#EA2831]"
          />
          <PrimaryBtn onClick={() => setShowNew(true)}>
            <span className="material-symbols-outlined text-base">move_down</span> Request Stock
          </PrimaryBtn>
        </div>
      </div>
      <div className="border border-stone-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[920px] resp-table">
          <thead><tr className="text-[10px] uppercase text-stone-400 bg-stone-50"><Th>Product</Th><Th right>Qty</Th><Th>From (source)</Th><Th>For (requester)</Th><Th>Transfer Ref.</Th><Th>Status</Th><Th>Requested</Th><Th right>Actions</Th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {visible.map((r) => (
              <tr key={r._id} className="hover:bg-stone-50/40">
                <td className="px-4 py-3 text-sm font-bold" data-label="Product">{r.productId?.productName || '—'}</td>
                <td className="px-4 py-3 text-sm text-right" data-label="Qty">{r.qty}</td>
                <td className="px-4 py-3 text-sm" data-label="From (source)">{r.fromWarehouseId?.name || '—'}</td>
                <td className="px-4 py-3 text-sm" data-label="For (requester)">{r.toWarehouseId?.name || '—'}{r.requestedBy?.name ? <span className="text-xs text-stone-400"> · {r.requestedBy.name}</span> : null}</td>
                {/* The reference of the shipment this request created — the exact
                    SH-… shown in Transfer History (server-supplied `transferRef`,
                    never rebuilt here). "Not created" until a shipment exists; a
                    request has at most one shipment, so no +N case. Shown in full,
                    monospace, no truncation. */}
                <td className="px-4 py-3" data-label="Transfer Ref.">
                  {r.transferRef
                    ? <span className="text-xs font-bold font-mono bg-stone-100 text-stone-700 px-2.5 py-1 rounded-full whitespace-nowrap">{r.transferRef}</span>
                    : <span className="text-xs text-stone-400">Not created</span>}
                </td>
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
            {visible.length === 0 && <tr><td colSpan={8} className="px-6 py-12 text-center text-sm text-stone-400">{needle ? `No request matches “${q.trim()}”.` : 'No stock requests yet. Use "Request Stock" to ask another warehouse for inventory.'}</td></tr>}
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
