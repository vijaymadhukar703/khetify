import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { Modal, Field, inputCls, PrimaryBtn, GhostBtn } from '../Company/ims/ImsUi';
import { ManifestModal } from '../../Components/ims/TransferModals';
import ScanBox from '../../Components/ims/ScanBox';
import { movementKind } from '../../lib/movementLabel';
import {
  getSellerLink, getSellerWarehouses,
  getSellerShipments, pickSellerShipment, packSellerShipment, dispatchSellerShipment, receiveSellerShipment, getSellerShipmentManifest,
  getSellerTransfers, createSellerTransfer, getSellerTransferStock, getSellerTransferWarehouses, acceptSellerTransfer, rejectSellerTransfer,
  getSellerSupplyOrders, receiveSellerSupply,
  sellerTraceLot, sellerTraceUnit,
} from '../../lib/sellerApi';
import { useSellerPermission } from '../../context/SellerPermissionContext';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiErr = (e) => toast('error', e?.response?.data?.message || e.message || 'Something went wrong');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// Send-Stock pipeline (mirrors the company Pick · Pack · Dispatch):
const PICK_STAGE = ['planned', 'picking']; // accepted transfers waiting to pick
const PACK_STAGE = ['picked', 'packing']; // fully picked, waiting to pack
const DISPATCH_STAGE = ['packed']; // packed, label-gated dispatch
const DISPATCHABLE = ['draft', 'planned', 'picking', 'picked', 'packed', 'approved', 'loading'];
const RECEIVABLE = ['in_transit', 'arrived', 'verifying'];
const SUPPLY_RECEIVABLE = ['dispatched', 'in_transit', 'arrived', 'partially_received'];
const SHIP_STATUS_STYLE = {
  planned: 'bg-stone-100 text-stone-600', picking: 'bg-amber-50 text-amber-700', picked: 'bg-blue-50 text-blue-700',
  packed: 'bg-blue-50 text-blue-700', approved: 'bg-blue-50 text-blue-700', loading: 'bg-blue-50 text-blue-700',
  in_transit: 'bg-violet-50 text-violet-700', arrived: 'bg-violet-50 text-violet-700', verifying: 'bg-amber-50 text-amber-700',
  received: 'bg-green-50 text-green-700', partially_received: 'bg-amber-50 text-amber-700', cancelled: 'bg-stone-100 text-stone-500',
};
// Total / picked unit counts for a transfer shipment (across its FEFO lots).
const lineUnits = (s) => (s.lines || []).reduce((n, l) => n + (l.qty || 0), 0);
const linePicked = (s) => (s.lines || []).reduce((n, l) => n + (l.pickedQty || 0), 0);
const REQ_STATUS_STYLE = {
  requested: 'bg-amber-50 text-amber-700', accepted: 'bg-blue-50 text-blue-700',
  fulfilled: 'bg-green-50 text-green-700', rejected: 'bg-red-50 text-red-700', cancelled: 'bg-stone-100 text-stone-500',
};

const TAB_DEFS = [
  { key: 'receive', label: 'Receive Stock', icon: 'move_to_inbox' },
  { key: 'send', label: 'Send Stock', icon: 'outbox' },
  { key: 'shipments', label: 'Shipment Tracking & Transfers', icon: 'local_shipping' },
  { key: 'trace', label: 'Traceability', icon: 'travel_explore' },
];

// Seller Operations — mirrors the company Operations module (Receive · Send ·
// Shipment Tracking & Transfers · Traceability), fed the seller's owner-aware
// data. Inter-warehouse transfers ride the full shipment lifecycle.
const SellerOperations = () => {
  const [params, setParams] = useSearchParams();
  const active = TAB_DEFS.find((t) => t.key === params.get('tab')) || TAB_DEFS[0];
  // Role + warehouse scope drive which action a user sees: a seller_manager may
  // only act on the warehouse(s) assigned to them; seller_admin acts on all.
  const { sellerCan: hasCap, warehouseIds = [], role } = useSellerPermission();
  const canWrite = hasCap('transfer:create');
  const myWh = (warehouseIds || []).map(String);
  const scoped = role !== 'seller_admin' && myWh.length > 0;
  const canActOn = (whId) => { const id = String(whId?._id ?? whId ?? ''); return !scoped || myWh.includes(id); };

  const [approved, setApproved] = useState(null);
  const [shipments, setShipments] = useState([]);
  const [requests, setRequests] = useState([]);
  const [supply, setSupply] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [manifest, setManifest] = useState(null); // { qrPayload } shipping label
  const [receiving, setReceiving] = useState(null); // { kind, item }
  const [picking, setPicking] = useState(null); // shipment in the scan-to-pick modal
  const [dispatching, setDispatching] = useState(null); // shipment in the label-gated dispatch modal
  const [showNewReq, setShowNewReq] = useState(false); // pull: "New request"

  const reload = useCallback(() => {
    getSellerShipments().then((r) => setShipments(r?.data || [])).catch(() => {});
    getSellerTransfers().then((r) => setRequests(r?.data || [])).catch(() => {});
    getSellerSupplyOrders().then((r) => setSupply(r?.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    getSellerLink().then((r) => {
      const ok = r?.data?.linkStatus === 'approved';
      if (!alive) return;
      setApproved(ok);
      if (!ok) return;
      reload();
      getSellerWarehouses().then((w) => { if (alive) setWarehouses(w?.data || []); }).catch(() => {});
    }).catch(() => { if (alive) setApproved(false); });
    return () => { alive = false; };
  }, [reload]);

  const accept = async (req) => {
    try { await acceptSellerTransfer(req._id); toast('success', 'Accepted — shipment created'); reload(); }
    catch (e) { apiErr(e); }
  };
  const reject = async (req) => {
    const { isConfirmed, value } = await Swal.fire({ title: `Reject request?`, input: 'text', inputLabel: 'Reason (optional)', showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'Reject' });
    if (!isConfirmed) return;
    try { await rejectSellerTransfer(req._id, { note: value || '' }); toast('success', 'Rejected'); reload(); }
    catch (e) { apiErr(e); }
  };
  const pack = async (s) => {
    try { await packSellerShipment(s._id); toast('success', 'Packed — ready to dispatch'); reload(); }
    catch (e) { apiErr(e); }
  };

  const incomingShipments = useMemo(() => shipments.filter((s) => RECEIVABLE.includes(s.status)), [shipments]);
  const incomingSupply = useMemo(() => supply.filter((o) => SUPPLY_RECEIVABLE.includes(o.status)), [supply]);
  const outgoing = useMemo(() => shipments.filter((s) => DISPATCHABLE.includes(s.status)), [shipments]);

  if (approved === null) return <div className="flex-1 p-8 text-center text-stone-400 font-sora">Loading…</div>;
  if (!approved) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">lock</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Operations are locked</h2>
          <p className="text-sm text-amber-700 mt-1">Available after your supplying company approves you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 font-sora">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Operations</h1>
      <p className="text-stone-500 mb-5">Receive, send, transfer and track your stock.</p>

      <div className="flex gap-1 border-b border-stone-200 mb-6 overflow-x-auto">
        {TAB_DEFS.map((t) => (
          <button key={t.key} onClick={() => setParams({ tab: t.key })}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px whitespace-nowrap transition-colors ${
              active.key === t.key ? 'border-[#EA2831] text-[#EA2831]' : 'border-transparent text-stone-400 hover:text-stone-700'
            }`}>
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {active.key === 'receive' && (
        <ReceiveTab
          shipments={incomingShipments} supply={incomingSupply} canWrite={canWrite} canActOn={canActOn}
          onScanShipment={(s) => setReceiving({ kind: 'transfer', item: s })}
          onScanSupply={(o) => setReceiving({ kind: 'supply', item: o })}
        />
      )}
      {active.key === 'send' && (
        <SendTab
          shipments={outgoing} canWrite={canWrite} canActOn={canActOn}
          onPick={(s) => setPicking(s)} onPack={pack} onDispatch={(s) => setDispatching(s)}
        />
      )}
      {active.key === 'shipments' && (
        <ShipmentsTab
          shipments={shipments} requests={requests} canWrite={canWrite} canActOn={canActOn}
          onLabel={(s) => setManifest({ qrPayload: `${s._id}.${s.qrToken || ''}` })}
          onReceive={(s) => setReceiving({ kind: 'transfer', item: s })}
          onAccept={accept} onReject={reject}
          onNewRequest={() => setShowNewReq(true)}
        />
      )}
      {active.key === 'trace' && <TraceTab />}

      {manifest && <ManifestModal info={manifest} onClose={() => setManifest(null)} />}
      {picking && (
        <TransferPickModal shipment={picking} onClose={() => setPicking(null)} onDone={() => { setPicking(null); reload(); }} />
      )}
      {dispatching && (
        <TransferDispatchModal shipment={dispatching} onClose={() => setDispatching(null)} onDone={() => { setDispatching(null); reload(); }} />
      )}
      {receiving && (
        <ScanReceiveModal
          target={receiving}
          onClose={() => setReceiving(null)}
          onDone={() => { setReceiving(null); reload(); }}
        />
      )}
      {showNewReq && <NewRequestModal warehouses={warehouses} onClose={() => setShowNewReq(false)} onDone={() => { setShowNewReq(false); reload(); setParams({ tab: 'shipments' }); }} />}
    </div>
  );
};

/* ───────── Receive Stock ───────── */
// Receiving is done by the DESTINATION warehouse (its manager) or seller_admin.
const ReceiveTab = ({ shipments, supply, canWrite, canActOn, onScanShipment, onScanSupply }) => (
  <div className="space-y-8">
    <Section title="Incoming transfers to receive" empty="No transfers awaiting receipt.">
      {shipments.map((s) => (
        <Row key={s._id} title={`${s.fromLabel || 'Source'} → ${s.toLabel}`} sub={`${(s.lines || []).length} lot(s) · ${fmtDate(s.dispatchedAt)}`}
          status={s.status} statusStyle={SHIP_STATUS_STYLE}
          action={canWrite && canActOn(s.toWarehouseId) && <ScanBtn onClick={() => onScanShipment(s)} />} />
      ))}
    </Section>
    <Section title="Incoming supply to receive" empty="No supply awaiting receipt.">
      {supply.map((o) => (
        <Row key={o._id} title={`${(o.items || []).length} item(s) → ${o.warehouseId?.name || 'warehouse'}`} sub={`Requested ${fmtDate(o.createdAt)}`}
          status={o.status} statusStyle={SHIP_STATUS_STYLE}
          action={canWrite && canActOn(o.warehouseId) && <ScanBtn onClick={() => onScanSupply(o)} />} />
      ))}
    </Section>
  </div>
);

/* ───────── Send Stock ───────── */
// Mirrors the company Send Stock (Operations → Send): three sub-tabs Pick · Pack
// · Dispatch. The SOURCE warehouse (or seller_admin) fulfils an accepted transfer
// by scanning to pick (until requested qty met), packing it, then printing the
// label and dispatching (label required). Receiving stays with the destination.
const SendTab = ({ shipments, canWrite, canActOn, onPick, onPack, onDispatch }) => {
  const [sub, setSub] = useState('pick');
  // Only the source warehouse's manager (or seller_admin) acts on a shipment.
  // This list carries BOTH inter-warehouse transfers AND customer orders — a
  // confirmed order becomes a customer shipment that rides this same pipeline.
  const mine = shipments.filter((s) => canActOn(s.fromWarehouseId));
  const pickList = mine.filter((s) => PICK_STAGE.includes(s.status));
  const packList = mine.filter((s) => PACK_STAGE.includes(s.status));
  const dispatchList = mine.filter((s) => DISPATCH_STAGE.includes(s.status));
  const counts = { pick: pickList.length, pack: packList.length, dispatch: dispatchList.length };

  return (
    <div>
      <div className="inline-flex rounded-lg border border-stone-200 bg-white overflow-hidden mb-4">
        {[['pick', 'Pick'], ['pack', 'Pack'], ['dispatch', 'Dispatch']].map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)} className={`px-4 py-1.5 text-xs font-bold transition-colors ${sub === k ? 'bg-[#EA2831] text-white' : 'text-stone-500 hover:bg-stone-50'}`}>
            {label}{counts[k] ? ` (${counts[k]})` : ''}
          </button>
        ))}
      </div>

      {sub === 'pick' && (
        <Section title="To pick — customer orders & transfers" empty="Nothing to pick. Confirm an order, or accept a transfer request.">
          {pickList.map((s) => (
            <Row key={s._id} title={`${s.fromLabel || 'Source'} → ${s.toLabel}`}
              sub={`${(s.lines || []).length} lot(s) · picked ${linePicked(s)}/${lineUnits(s)}`}
              status={s.status} statusStyle={SHIP_STATUS_STYLE}
              action={canWrite && (
                <button onClick={() => onPick(s)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#EA2831] text-white hover:bg-red-600">
                  <span className="material-symbols-outlined text-sm align-middle mr-1">qr_code_scanner</span>Pick
                </button>
              )} />
          ))}
        </Section>
      )}

      {sub === 'pack' && (
        <Section title="Picked — ready to pack" empty="Nothing to pack. Fully pick a shipment first.">
          {packList.map((s) => (
            <Row key={s._id} title={`${s.fromLabel || 'Source'} → ${s.toLabel}`}
              sub={`${(s.lines || []).length} lot(s) · picked ${linePicked(s)}/${lineUnits(s)}`}
              status={s.status} statusStyle={SHIP_STATUS_STYLE}
              action={canWrite && (
                <button onClick={() => onPack(s)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#EA2831] text-white hover:bg-red-600">Pack</button>
              )} />
          ))}
        </Section>
      )}

      {sub === 'dispatch' && (
        <Section title="Packed — ready to dispatch" empty="Nothing to dispatch. Pack a shipment first.">
          {dispatchList.map((s) => (
            <Row key={s._id} title={`${s.fromLabel || 'Source'} → ${s.toLabel}`}
              sub={`${(s.lines || []).length} lot(s) · print label to dispatch`}
              status={s.status} statusStyle={SHIP_STATUS_STYLE}
              action={canWrite && (
                <button onClick={() => onDispatch(s)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#EA2831] text-white hover:bg-red-600">Dispatch</button>
              )} />
          ))}
        </Section>
      )}
    </div>
  );
};

// Scan-to-pick (mirrors the company OrderPickModal / SupplyPickModal): scan a
// unit/lot per unit until each FEFO line's requested qty is met (progress shown),
// or fall back to per-line quantities. Scanned serials are distributed FEFO and
// recorded; the shipment can't be packed until every line is fully picked.
const TransferPickModal = ({ shipment, onClose, onDone }) => {
  const lines = shipment.lines || [];
  const [scanned, setScanned] = useState([]); // codes scanned this session
  const [qty, setQty] = useState(() => lines.map(() => '')); // manual fallback per line
  const [busy, setBusy] = useState(false);

  const remainingOf = (l) => (l.qty || 0) - (l.pickedQty || 0);
  const totalRemaining = lines.reduce((n, l) => n + remainingOf(l), 0);

  const addScan = (code) => {
    const c = String(code || '').trim();
    if (!c) return;
    setScanned((prev) => (prev.includes(c) || prev.length >= totalRemaining ? prev : [...prev, c]));
  };

  const submit = async () => {
    // Serialized path: distribute the scanned codes FEFO across the open lines.
    let picks;
    if (scanned.length) {
      const codes = [...scanned];
      picks = [];
      lines.forEach((l, i) => {
        const take = Math.min(remainingOf(l), codes.length);
        if (take > 0) { picks.push({ lineIndex: i, serials: codes.splice(0, take) }); }
      });
    } else {
      picks = lines
        .map((l, i) => ({ lineIndex: i, qty: Math.min(remainingOf(l), Number(qty[i]) || 0) }))
        .filter((p) => p.qty > 0);
    }
    if (!picks.length) { toast('error', 'Scan units/lots or enter a quantity to pick'); return; }
    setBusy(true);
    try {
      const r = await pickSellerShipment(shipment._id, { picks });
      toast('success', r?.data?.status === 'picked' ? 'Fully picked — ready to pack' : 'Pick updated');
      onDone();
    } catch (e) { apiErr(e); } finally { setBusy(false); }
  };

  // FEFO preview: how the scanned count fills each line, on top of prior picks.
  let pool = scanned.length;
  const previewFor = (l) => { const take = Math.min(remainingOf(l), pool); pool -= take; return (l.pickedQty || 0) + take; };

  return (
    <Modal title={`Pick → ${shipment.toLabel}`} onClose={onClose}>
      <p className="text-xs text-stone-500 mb-3">Scan each unit/lot (camera or wedge scanner) until every line reaches its requested quantity — or enter quantities below. Pack is locked until the shipment is fully picked.</p>
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Scan units / lots</p>
      <ScanBox onScan={addScan} placeholder="Scan a unit serial or lot code" autoFocus disabled={totalRemaining === 0} />
      {scanned.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {scanned.map((c) => <span key={c} className="text-[10px] font-mono bg-stone-100 rounded px-1.5 py-0.5 text-stone-600">{c}</span>)}
        </div>
      )}
      <div className="border border-stone-200 rounded-xl overflow-hidden my-3">
        <table className="w-full text-left text-sm">
          <thead><tr className="bg-stone-50 text-[10px] uppercase text-stone-400"><th className="px-3 py-2 font-bold">Lot</th><th className="px-3 py-2 font-bold text-center">Picked / Req</th><th className="px-3 py-2 font-bold text-right">Qty</th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {lines.map((l, i) => {
              const picked = scanned.length ? previewFor(l) : (l.pickedQty || 0);
              const done = picked >= (l.qty || 0);
              return (
                <tr key={i}>
                  <td className="px-3 py-1.5 font-mono text-xs text-stone-700">{l.lotNumber || l.batchNumber || '—'}</td>
                  <td className={`px-3 py-1.5 text-center font-bold ${done ? 'text-green-600' : 'text-stone-700'}`}>{picked}/{l.qty}</td>
                  <td className="px-3 py-1.5 text-right">
                    <input type="number" min="0" max={remainingOf(l)} disabled={scanned.length > 0 || remainingOf(l) === 0}
                      className={`${inputCls} w-20 text-right py-1`} value={qty[i]} placeholder="0"
                      onChange={(e) => setQty((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))} />
                  </td>
                </tr>
              );
            })}
            {lines.length === 0 && <tr><td colSpan={3} className="px-3 py-3 text-center text-xs text-stone-400">No lines.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2">
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn disabled={busy} onClick={submit}>{busy ? 'Picking…' : 'Confirm pick'}</PrimaryBtn>
      </div>
    </Modal>
  );
};

/* ───────── Shipment Tracking & Transfers ───────── */
const ShipmentsTab = ({ shipments, requests, canWrite, canActOn, onLabel, onReceive, onAccept, onReject, onNewRequest }) => {
  const [sub, setSub] = useState('shipments');
  // The decider for a request: pull → the HOLDER (from); push → the DESTINATION (to).
  const deciderWh = (r) => (r.mode === 'pull' ? r.fromWarehouseId : r.toWarehouseId);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="inline-flex rounded-lg border border-stone-200 bg-white overflow-hidden">
          {[['shipments', 'Shipments'], ['requests', 'Requests']].map(([k, label]) => (
            <button key={k} onClick={() => setSub(k)} className={`px-4 py-1.5 text-xs font-bold transition-colors ${sub === k ? 'bg-[#EA2831] text-white' : 'text-stone-500 hover:bg-stone-50'}`}>{label}</button>
          ))}
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <button onClick={onNewRequest} className="inline-flex items-center gap-1 text-sm font-bold px-3.5 py-2 rounded-lg border border-[#EA2831] text-[#EA2831] hover:bg-red-50 transition-colors">
              <span className="material-symbols-outlined text-base">download</span> New request
            </button>
          </div>
        )}
      </div>

      {sub === 'shipments' ? (
        <div className="bg-white border border-stone-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[760px] resp-table">
            <thead><tr className="bg-stone-50/50 border-b border-stone-200">{['To', 'Type', 'Status', 'Dispatched', 'Actions'].map((h) => <th key={h} className="px-5 py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-stone-100">
              {shipments.length === 0 ? <tr><td colSpan={5} className="px-5 py-10 text-center text-stone-400">No shipments yet.</td></tr>
                : shipments.map((s) => (
                  <tr key={s._id} className="hover:bg-stone-50/40">
                    <td data-label="To" className="px-5 py-3 text-sm font-bold text-stone-800">{s.toLabel}</td>
                    <td data-label="Type" className="px-5 py-3 text-sm text-stone-600">{movementKind({ toType: s.toType, refType: s.refType })}</td>
                    <td data-label="Status" className="px-5 py-3"><span className={`text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${SHIP_STATUS_STYLE[s.status] || 'bg-stone-100 text-stone-500'}`}>{(s.status || '').replace(/_/g, ' ')}</span></td>
                    <td data-label="Dispatched" className="px-5 py-3 text-sm text-stone-500">{fmtDate(s.dispatchedAt)}</td>
                    <td className="px-5 py-3 cell-actions text-right">
                      <div className="flex items-center justify-end gap-2">
                        {s.qrToken && canActOn(s.fromWarehouseId) && <button onClick={() => onLabel(s)} className="text-xs font-bold text-stone-500 hover:text-[#EA2831]">Shipping Label</button>}
                        {canWrite && DISPATCHABLE.includes(s.status) && canActOn(s.fromWarehouseId) && <span className="text-[11px] text-stone-400">Fulfil in Send Stock</span>}
                        {canWrite && RECEIVABLE.includes(s.status) && canActOn(s.toWarehouseId) && <button onClick={() => onReceive(s)} className="text-xs font-bold text-[#EA2831]">Receive Lot</button>}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[820px] resp-table">
            <thead><tr className="bg-stone-50/50 border-b border-stone-200">{['Product', 'Type', 'From → To', 'Qty', 'Status', 'Actions'].map((h) => <th key={h} className="px-5 py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-stone-100">
              {requests.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-stone-400">No transfer requests yet.</td></tr>
                : requests.map((r) => {
                  const isPull = r.mode === 'pull';
                  const canDecide = canActOn(deciderWh(r));
                  return (
                  <tr key={r._id} className="hover:bg-stone-50/40">
                    <td data-label="Product" className="px-5 py-3 text-sm font-bold text-stone-800">{r.productId?.productName || '—'}</td>
                    <td data-label="Type" className="px-5 py-3"><span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${isPull ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'}`}>{isPull ? 'Request (pull)' : 'Transfer (push)'}</span></td>
                    <td data-label="From → To" className="px-5 py-3 text-sm text-stone-600"><b className="text-stone-900">{r.fromWarehouseId?.name || '—'}</b> → <b className="text-stone-900">{r.toWarehouseId?.name || '—'}</b></td>
                    <td data-label="Qty" className="px-5 py-3 text-sm font-bold text-stone-900">{r.qty}</td>
                    <td data-label="Status" className="px-5 py-3"><span className={`text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${REQ_STATUS_STYLE[r.status] || 'bg-stone-100 text-stone-500'}`}>{r.status}</span></td>
                    <td className="px-5 py-3 cell-actions text-right">
                      {/* The decider is the stock HOLDER: pull → source, push → destination. */}
                      {canWrite && r.status === 'requested' && canDecide && (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => onAccept(r)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#EA2831] text-white hover:bg-red-600">Accept</button>
                          <button onClick={() => onReject(r)} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">Reject</button>
                        </div>
                      )}
                      {r.status === 'requested' && !canDecide && (
                        <span className="text-[11px] text-stone-400">{isPull ? 'Awaiting holding warehouse' : 'Awaiting destination'}</span>
                      )}
                      {r.status === 'accepted' && <span className="text-[11px] text-stone-400">Dispatch &amp; receive in Shipments</span>}
                    </td>
                  </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/* ───────── Traceability ───────── */
const TraceTab = () => {
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = (value) => {
    const q = String(value ?? code).trim();
    if (!q) return;
    setLoading(true);
    // Try lot first (the common case); fall back to a unit serial.
    sellerTraceLot(q)
      .then((r) => setResult({ kind: 'lot', data: r?.data }))
      .catch(() => sellerTraceUnit(q).then((r) => setResult({ kind: 'unit', data: r?.data })).catch((e) => { apiErr(e); setResult(null); }))
      .finally(() => setLoading(false));
  };

  return (
    <div className="space-y-5">
      <div className="bg-stone-50 border border-stone-200 rounded-xl p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-2">Scan or enter a lot number / unit serial</p>
        <ScanBox onScan={(c) => { setCode(c); run(c); }} placeholder="Scan a unit / lot, or type then Enter" />
      </div>
      {loading && <p className="text-sm text-stone-400">Tracing…</p>}
      {result?.kind === 'lot' && <LotTrace data={result.data} />}
      {result?.kind === 'unit' && <UnitTrace data={result.data} />}
    </div>
  );
};

const LotTrace = ({ data }) => (
  <div className="space-y-4">
    <h3 className="text-base font-bold text-stone-900">Lot {data.lotNumber}</h3>
    <div className="bg-white border border-stone-200 rounded-2xl overflow-x-auto">
      <table className="w-full text-left text-sm min-w-[520px] resp-table">
        <thead><tr className="bg-stone-50 text-[10px] uppercase text-stone-400">{['Product', 'Warehouse', 'Qty'].map((h) => <th key={h} className="px-4 py-2 font-bold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-stone-100">
          {data.stock.map((s) => (
            <tr key={s._id}><td className="px-4 py-2 text-stone-700">{s.productId?.productName || '—'}</td><td className="px-4 py-2 text-stone-600">{s.warehouseId?.name || 'Unassigned'}</td><td className="px-4 py-2 font-bold text-stone-900">{s.availableStock}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Movement ledger ({data.movements.length})</p>
    <div className="bg-white border border-stone-200 rounded-2xl overflow-x-auto">
      <table className="w-full text-left text-sm min-w-[520px] resp-table">
        <thead><tr className="bg-stone-50 text-[10px] uppercase text-stone-400">{['When', 'Type', 'Qty', 'Balance'].map((h) => <th key={h} className="px-4 py-2 font-bold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-stone-100">
          {data.movements.map((m) => (
            <tr key={m._id}><td className="px-4 py-2 text-stone-500 text-xs">{fmtDate(m.createdAt)}</td><td className="px-4 py-2 text-stone-700">{m.type}</td><td className={`px-4 py-2 font-bold ${m.quantity < 0 ? 'text-red-600' : 'text-green-600'}`}>{m.quantity}</td><td className="px-4 py-2 text-stone-600">{m.balanceAfter}</td></tr>
          ))}
          {data.movements.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-stone-400 text-xs">No movements.</td></tr>}
        </tbody>
      </table>
    </div>
  </div>
);

const UnitTrace = ({ data }) => (
  <div className="space-y-4">
    <h3 className="text-base font-bold text-stone-900">Unit {data.unit?.serial}</h3>
    <p className="text-sm text-stone-600">{data.unit?.productId?.productName || '—'} · status <b className="capitalize">{data.unit?.status}</b></p>
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Journey ({(data.events || []).length})</p>
    <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100">
      {(data.events || []).map((e) => (
        <div key={e._id} className="flex items-center justify-between px-4 py-2.5 text-sm">
          <span className="text-stone-700">{e.event} <span className="text-stone-400">({e.fromStatus} → {e.toStatus})</span></span>
          <span className="text-xs text-stone-400">{fmtDate(e.at)}</span>
        </div>
      ))}
      {(data.events || []).length === 0 && <p className="px-4 py-6 text-center text-stone-400 text-xs">No events.</p>}
    </div>
  </div>
);

/* ───────── shared bits ───────── */
const Section = ({ title, empty, children }) => {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">{title}</p>
      <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100">
        {items.length ? items : <p className="px-5 py-8 text-center text-sm text-stone-400">{empty}</p>}
      </div>
    </div>
  );
};
const Row = ({ title, sub, status, statusStyle, action }) => (
  <div className="flex items-center gap-3 px-5 py-3.5">
    <div className="min-w-0 flex-1">
      <p className="text-sm font-bold text-stone-800 truncate">{title}</p>
      <p className="text-[11px] text-stone-400">{sub}</p>
    </div>
    {status && <span className={`shrink-0 text-[10px] font-bold rounded-full px-2.5 py-1 capitalize ${statusStyle[status] || 'bg-stone-100 text-stone-500'}`}>{(status || '').replace(/_/g, ' ')}</span>}
    {action}
  </div>
);
const ScanBtn = ({ onClick }) => (
  <button onClick={onClick} className="shrink-0 inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-[#EA2831] text-white hover:bg-red-600">
    <span className="material-symbols-outlined text-sm">qr_code_scanner</span> Scan to receive
  </button>
);

// Scan-to-receive: works for a transfer shipment (receiveSellerShipment) or a
// supply order (receiveSellerSupply). The manifest QR is mandatory.
const ScanReceiveModal = ({ target, onClose, onDone }) => {
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const isSupply = target.kind === 'supply';
  const expectedPrefix = isSupply ? (target.item.shipmentId?._id ? `${target.item.shipmentId._id}.` : '') : `${target.item._id}.`;
  const scanned = !!qr.trim();
  const looksRight = scanned && (!expectedPrefix || qr.trim().startsWith(expectedPrefix));

  const run = async () => {
    setBusy(true);
    try {
      if (isSupply) await receiveSellerSupply(target.item._id, { qr: qr.trim() });
      else await receiveSellerShipment(target.item._id, { qr: qr.trim() });
      toast('success', 'Received & verified — stock updated');
      onDone();
    } catch (e) { apiErr(e); } finally { setBusy(false); }
  };

  return (
    <Modal title="Scan to receive" onClose={onClose}>
      <p className="text-xs text-stone-500 mb-3">Scan the manifest barcode/QR on the shipment label (camera or wedge scanner) — or paste it. The system verifies it before receiving.</p>
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Scan the shipping label</p>
      <ScanBox onScan={(c) => setQr(c)} placeholder="Scan or paste the manifest code" autoFocus />
      {scanned && <p className={`mt-2 text-[11px] font-mono break-all ${looksRight ? 'text-green-600' : 'text-red-600'}`}>{looksRight ? '✓' : '✕'} {qr.trim()}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn disabled={!scanned || busy} onClick={run}>{busy ? 'Receiving…' : 'Verify & receive'}</PrimaryBtn>
      </div>
    </Modal>
  );
};

// PULL: "I ask another of my warehouses to send me stock." To = my warehouse
// (the receiver), From = the holder I'm requesting from, Product = what the
// holder has in stock. Creates a pull TransferRequest (holder accepts/dispatches,
// I receive).
const NewRequestModal = ({ warehouses, onClose, onDone }) => {
  const [f, setF] = useState({ toWarehouseId: '', fromWarehouseId: '', productId: '', qty: '', note: '' });
  const [stock, setStock] = useState(null);
  const [loadingStock, setLoadingStock] = useState(false);
  const [accountWh, setAccountWh] = useState(null);
  const [busy, setBusy] = useState(false);
  const u = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));

  // To = my warehouse(s) (manager → assigned; admin → all). From = ANY other
  // seller warehouse (the holder), minus my chosen destination.
  const toOptions = warehouses;
  const fromOptions = (accountWh || []).filter((w) => String(w._id) !== String(f.toWarehouseId));
  const enoughWarehouses = accountWh === null ? true : accountWh.length >= 2;
  const selectedProduct = (stock || []).find((p) => String(p.productId) === String(f.productId));

  useEffect(() => {
    let alive = true;
    getSellerTransferWarehouses().then((r) => { if (alive) setAccountWh(r?.data || []); }).catch(() => { if (alive) setAccountWh([]); });
    return () => { alive = false; };
  }, []);

  // Products the HOLDER warehouse currently has in stock (forRequest reads
  // another of your warehouses, bypassing your own manager scope).
  useEffect(() => {
    if (!f.fromWarehouseId) { setStock(null); return undefined; }
    let alive = true;
    setLoadingStock(true);
    setF((prev) => ({ ...prev, productId: '' }));
    getSellerTransferStock(f.fromWarehouseId, { forRequest: 1 })
      .then((r) => { if (alive) setStock(r?.data || []); })
      .catch((e) => { if (alive) { setStock([]); apiErr(e); } })
      .finally(() => { if (alive) setLoadingStock(false); });
    return () => { alive = false; };
  }, [f.fromWarehouseId]);

  const submit = async () => {
    if (!f.toWarehouseId || !f.fromWarehouseId || !f.productId || !f.qty) { toast('error', 'Pick your warehouse, the holder, a product and a quantity'); return; }
    setBusy(true);
    try {
      await createSellerTransfer({ fromWarehouseId: f.fromWarehouseId, toWarehouseId: f.toWarehouseId, productId: f.productId, qty: Number(f.qty), note: f.note, mode: 'pull' });
      toast('success', 'Request sent');
      onDone();
    } catch (e) { apiErr(e); } finally { setBusy(false); }
  };

  if (!enoughWarehouses) {
    return (
      <Modal title="New request" onClose={onClose}>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
          <span className="material-symbols-outlined text-amber-500 text-3xl">warehouse</span>
          <p className="text-sm font-bold text-amber-800 mt-1">You need at least 2 warehouses</p>
          <p className="text-xs text-amber-700 mt-0.5">Add another warehouse to request stock between them.</p>
        </div>
        <div className="mt-4 flex justify-end"><GhostBtn onClick={onClose}>Close</GhostBtn></div>
      </Modal>
    );
  }

  return (
    <Modal title="New request" onClose={onClose}>
      <p className="text-xs text-stone-500 mb-3">Ask another of your warehouses to send you stock. The holding warehouse accepts &amp; dispatches; you receive.</p>
      <Field label="To warehouse (mine) *">
        <select className={inputCls} value={f.toWarehouseId} onChange={u('toWarehouseId')}>
          <option value="">Select your warehouse…</option>
          {toOptions.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
        </select>
      </Field>
      <Field label="From warehouse (holder) *">
        <select className={inputCls} value={f.fromWarehouseId} onChange={u('fromWarehouseId')} disabled={!f.toWarehouseId}>
          <option value="">{f.toWarehouseId ? 'Select the warehouse to request from…' : 'Pick your warehouse first'}</option>
          {fromOptions.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
        </select>
      </Field>
      <Field label="Product *">
        <select className={inputCls} value={f.productId} onChange={u('productId')} disabled={!f.fromWarehouseId || loadingStock || !(stock && stock.length)}>
          <option value="">
            {!f.fromWarehouseId ? 'Pick a holding warehouse first'
              : loadingStock ? 'Loading stock…'
              : stock && stock.length === 0 ? 'That warehouse has no stock to send'
              : 'Select product…'}
          </option>
          {(stock || []).map((p) => (
            <option key={p.productId} value={p.productId}>
              {p.productName}{p.skuNumber ? ` · ${p.skuNumber}` : ''} — {p.availableQty} in stock
            </option>
          ))}
        </select>
        {f.fromWarehouseId && stock && stock.length === 0 && !loadingStock && (
          <p className="text-[11px] text-amber-600 mt-1">That warehouse has no stock to send.</p>
        )}
      </Field>
      <Field label={`Quantity *${selectedProduct ? ` (max ${selectedProduct.availableQty})` : ''}`}>
        <input type="number" min="1" max={selectedProduct?.availableQty || undefined} className={inputCls} value={f.qty} onChange={u('qty')} />
      </Field>
      <Field label="Note"><input className={inputCls} value={f.note} onChange={u('note')} placeholder="Optional" /></Field>
      <PrimaryBtn disabled={busy || !f.productId} onClick={submit}>{busy ? 'Sending…' : 'Send request'}</PrimaryBtn>
    </Modal>
  );
};

// Label-gated dispatch for a transfer shipment — mirrors the company supply
// SupplyDispatchModal: the lines are FEFO-picked at acceptance (shown read-only),
// you MUST print the shipping label, and Confirm Dispatch stays disabled until
// it's printed. Dispatch sends the stock in-transit; the destination scans to
// receive.
const TransferDispatchModal = ({ shipment, onClose, onDone }) => {
  const [f, setF] = useState({ vehicleNo: '', driverName: '', driverPhone: '', transporter: '' });
  const [labelInfo, setLabelInfo] = useState(null); // { qrPayload } once produced
  const [showLabel, setShowLabel] = useState(false);
  const [busy, setBusy] = useState(false);
  const u = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const labelReady = !!labelInfo;

  const openLabel = async () => {
    if (labelInfo) { setShowLabel(true); return; }
    try {
      const r = await getSellerShipmentManifest(shipment._id);
      const qrPayload = r?.data?.qrPayload;
      if (!qrPayload) { toast('error', 'Could not build the shipping label'); return; }
      setLabelInfo({ qrPayload });
      setShowLabel(true);
    } catch (e) { apiErr(e); }
  };
  const submit = async () => {
    setBusy(true);
    try {
      await dispatchSellerShipment(shipment._id, { labelPrinted: true, ...f });
      toast('success', 'Dispatched — stock is in transit');
      onDone();
    } catch (e) { apiErr(e); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Dispatch → ${shipment.toLabel}`} onClose={onClose}>
      <p className="text-xs text-stone-400 mb-3">Picked &amp; packed. Print the shipping label, then dispatch — stock leaves the source now and the destination scans to receive.</p>
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Packed lots</p>
      <div className="border border-stone-200 rounded-xl overflow-hidden mb-3">
        <table className="w-full text-left text-sm">
          <thead><tr className="bg-stone-50 text-[10px] uppercase text-stone-400"><th className="px-3 py-2 font-bold">Lot</th><th className="px-3 py-2 font-bold text-right">Qty</th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {(shipment.lines || []).map((l, i) => (
              <tr key={i}><td className="px-3 py-1.5 font-mono text-xs text-stone-700">{l.lotNumber || l.batchNumber || '—'}</td><td className="px-3 py-1.5 text-right font-bold text-stone-900">{l.qty}</td></tr>
            ))}
            {(!shipment.lines || !shipment.lines.length) && <tr><td colSpan={2} className="px-3 py-3 text-center text-xs text-stone-400">No lines.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Vehicle No."><input className={inputCls} value={f.vehicleNo} onChange={u('vehicleNo')} placeholder="MP20 GA 1234" /></Field>
        <Field label="Transporter"><input className={inputCls} value={f.transporter} onChange={u('transporter')} /></Field>
        <Field label="Driver"><input className={inputCls} value={f.driverName} onChange={u('driverName')} /></Field>
        <Field label="Driver phone"><input className={inputCls} value={f.driverPhone} onChange={u('driverPhone')} /></Field>
      </div>
      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-2">
          <GhostBtn onClick={openLabel}><span className="material-symbols-outlined text-base">print</span> {labelReady ? 'Re-open shipping label' : 'Print shipping label'}</GhostBtn>
          {labelReady && <span className="text-xs font-bold text-green-600">✓ Label ready</span>}
        </div>
        <PrimaryBtn disabled={!labelReady || busy} onClick={submit}>{busy ? 'Dispatching…' : 'Confirm Dispatch'}</PrimaryBtn>
        {!labelReady && <p className="text-[11px] text-stone-400">Print the shipping label (scannable QR + barcode) to enable dispatch.</p>}
      </div>
      {showLabel && labelInfo && <ManifestModal info={labelInfo} onClose={() => setShowLabel(false)} />}
    </Modal>
  );
};

export default SellerOperations;
