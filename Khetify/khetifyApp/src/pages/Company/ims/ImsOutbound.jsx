import React, { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import {
  getOrders, pickOrder,
  getPackages, createPackage, dispatchOrder,
  getSupplyOrders, pickSupplyOrder, packSupplyOrder, getSupplyManifest, dispatchSupplyOrder,
} from '../../../lib/imsApi';
import { Modal, Field, inputCls, PrimaryBtn, GhostBtn } from './ImsUi';
import ScanBox from '../../../Components/ims/ScanBox';
import { ManifestModal } from '../../../Components/ims/TransferModals';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');
const listOf = (r) => (Array.isArray(r) ? r : r?.data || r?.products || []);

// A scanned unit serial. Serials are now prefix-less (<lotkey>-<3+ digit seq>,
// e.g. ABSAMIO012-001); we still accept a legacy "K-U-" on old printed labels.
const UNIT_SERIAL_RE = /^(K-U-)?[A-Z0-9]+-\d{3,}$/i;

// Seller supply orders are picked/packed/dispatched DIRECTLY (no wave/PickList).
const supplySeller = (o) => o.sellerId?.sellerInfo?.businessName || 'Seller';
const supplyItems = (o) => (o.items || []).map((it) => `${it.productId?.productName || 'Item'} ×${it.quantity}`).join(', ');
const supplyUnits = (o) => (o.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
const supplyPicked = (o) => (o.items || []).reduce((s, it) => s + (it.pickedQty || 0), 0);
const firstProductId = (o) => { const p = o.items?.[0]?.productId; return p?._id || p; };

const ImsOutbound = () => {
  const [tab, setTab] = useState('pick');
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-1 border-b border-stone-200">
          {[['pick', 'Pick'], ['pack', 'Pack'], ['dispatch', 'Dispatch']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-5 py-2.5 text-sm font-bold border-b-2 -mb-px ${tab === k ? 'border-[#EA2831] text-[#EA2831]' : 'border-transparent text-stone-400 hover:text-stone-700'}`}>{label}</button>
          ))}
        </div>
        {tab === 'pick' && <PickTab />}
        {tab === 'pack' && <PackTab />}
        {tab === 'dispatch' && <DispatchTab />}
      </div>
    </div>
  );
};

const SectionHeader = ({ children }) => <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{children}</p>;
const SupplyTag = () => <span className="text-[10px] font-bold text-violet-600 bg-violet-50 rounded px-1.5 py-0.5">SUPPLY</span>;

/* ───────────── Pick ───────────── */
// Confirmed orders AND approved supply are picked DIRECTLY here — no waves.
const orderTitle = (o) => o.invoiceNumber || o.orderNumber || 'Order';
const orderUnits = (o) => (o.items || []).reduce((s, it) => s + (it.qty || 0), 0);
const orderPicked = (o) => (o.items || []).reduce((s, it) => s + (it.pickedQty || 0), 0);

const PickTab = () => {
  const [orders, setOrders] = useState([]);
  const [supply, setSupply] = useState([]);
  const [pickingOrder, setPickingOrder] = useState(null);
  const [pickingSupply, setPickingSupply] = useState(null);

  const refresh = () => {
    getOrders({ status: 'confirmed' }).then((r) => setOrders(listOf(r))).catch(apiError);
    getSupplyOrders({ stage: 'pick' }).then((r) => setSupply(listOf(r))).catch(() => {});
  };
  useEffect(() => { refresh(); }, []);

  return (
    <>
      {/* Approved seller supply — direct pick */}
      <div className="space-y-2">
        <SectionHeader>{supply.length} approved supply to pick</SectionHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {supply.map((o) => (
            <div key={o._id} className="border border-violet-100 bg-violet-50/30 rounded-xl p-4 flex justify-between items-center">
              <div>
                <p className="font-bold text-sm flex items-center gap-2"><SupplyTag /> {supplySeller(o)}</p>
                <p className="text-xs text-stone-500">{supplyItems(o)}</p>
                <p className="text-[11px] text-stone-400 mt-0.5">From {o.sourceWarehouseId?.name || 'source'} · picked {supplyPicked(o)}/{supplyUnits(o)}</p>
              </div>
              <PrimaryBtn onClick={() => setPickingSupply(o)}>Pick</PrimaryBtn>
            </div>
          ))}
          {supply.length === 0 && <p className="text-sm text-stone-400 col-span-full py-2">No approved supply waiting to pick.</p>}
        </div>
      </div>

      {/* Confirmed customer orders — direct pick (no wave) */}
      <div className="space-y-2 mt-6">
        <SectionHeader>{orders.length} confirmed order(s) to pick</SectionHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {orders.map((o) => (
            <div key={o._id} className="border border-stone-200 rounded-xl p-4 flex justify-between items-center">
              <div>
                <p className="font-bold text-sm">{orderTitle(o)}</p>
                <p className="text-xs text-stone-500">{o.customerName || '—'}</p>
                <p className="text-[11px] text-stone-400 mt-0.5">picked {orderPicked(o)}/{orderUnits(o) || o.totalUnits || 0}</p>
              </div>
              <PrimaryBtn onClick={() => setPickingOrder(o)}>Pick</PrimaryBtn>
            </div>
          ))}
          {orders.length === 0 && <p className="text-sm text-stone-400 col-span-full py-2">No confirmed orders waiting to pick.</p>}
        </div>
      </div>

      {pickingOrder && <OrderPickModal order={pickingOrder} onClose={() => setPickingOrder(null)} onDone={() => { setPickingOrder(null); refresh(); }} />}
      {pickingSupply && <SupplyPickModal order={pickingSupply} onClose={() => setPickingSupply(null)} onDone={() => { setPickingSupply(null); refresh(); }} />}
    </>
  );
};

// Direct scan-pick a confirmed ORDER against its reserved allocations (no wave).
const OrderPickModal = ({ order, onClose, onDone }) => {
  const [scanned, setScanned] = useState([]);
  const [qtys, setQtys] = useState(() => Object.fromEntries((order.items || []).map((it) => [String(it.productId?._id || it.productId), ''])));
  const onScan = (code) => { if (UNIT_SERIAL_RE.test(code) && !scanned.includes(code)) setScanned((s) => [...s, code]); };
  const setQty = (pid, v) => setQtys((q) => ({ ...q, [pid]: v }));

  const submit = async () => {
    try {
      let picks;
      if (scanned.length) {
        picks = [{ productId: firstProductId(order), serials: scanned }];
      } else {
        picks = (order.items || [])
          .map((it) => ({ productId: it.productId?._id || it.productId, qty: Number(qtys[String(it.productId?._id || it.productId)] || 0) }))
          .filter((p) => p.qty > 0);
        if (!picks.length) { toast('error', 'Scan serials or enter a quantity'); return; }
      }
      const r = await pickOrder(order._id, { picks });
      toast('success', r?.message || 'Picked');
      onDone();
    } catch (err) { apiError(err); }
  };

  return (
    <Modal title={`Pick ${orderTitle(order)}`} onClose={onClose} wide>
      <div className="mb-3"><ScanBox onScan={onScan} placeholder="Scan unit serials to pick" /></div>
      {scanned.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1">
          {scanned.map((s) => <span key={s} className="text-[11px] font-mono bg-stone-100 rounded px-2 py-0.5">{s}</span>)}
        </div>
      ) : (
        <div className="space-y-2">
          {(order.items || []).map((it) => {
            const pid = String(it.productId?._id || it.productId);
            return (
              <div key={pid} className="flex items-center justify-between gap-2 border border-stone-100 rounded-lg px-3 py-2">
                <div className="text-sm">
                  <span className="font-bold">{it.name || it.productId?.productName || 'Item'}</span>
                  <span className="text-stone-400 ml-2">picked {it.pickedQty || 0}/{it.qty}</span>
                </div>
                <input type="number" min="0" placeholder="Qty" className={`${inputCls} w-24`} value={qtys[pid]} onChange={(e) => setQty(pid, e.target.value)} />
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-stone-400 my-3">{scanned.length ? `${scanned.length} unit(s) scanned` : 'Scan serials, or enter a quantity per item for non-serialized stock.'}</p>
      <PrimaryBtn onClick={submit}>Confirm Pick</PrimaryBtn>
    </Modal>
  );
};

// Direct scan-pick a supply order against its reserved allocations (no wave).
const SupplyPickModal = ({ order, onClose, onDone }) => {
  const [scanned, setScanned] = useState([]);
  const [qtys, setQtys] = useState(() => Object.fromEntries((order.items || []).map((it) => [String(it.productId?._id || it.productId), ''])));
  const onScan = (code) => { if (UNIT_SERIAL_RE.test(code) && !scanned.includes(code)) setScanned((s) => [...s, code]); };
  const setQty = (pid, v) => setQtys((q) => ({ ...q, [pid]: v }));

  const submit = async () => {
    try {
      let picks;
      if (scanned.length) {
        picks = [{ productId: firstProductId(order), serials: scanned }];
      } else {
        picks = (order.items || [])
          .map((it) => ({ productId: it.productId?._id || it.productId, qty: Number(qtys[String(it.productId?._id || it.productId)] || 0) }))
          .filter((p) => p.qty > 0);
        if (!picks.length) { toast('error', 'Scan serials or enter a quantity'); return; }
      }
      const r = await pickSupplyOrder(order._id, { picks });
      toast('success', r?.message || 'Picked');
      onDone();
    } catch (err) { apiError(err); }
  };

  return (
    <Modal title={`Pick supply · ${supplySeller(order)}`} onClose={onClose} wide>
      <div className="mb-3"><ScanBox onScan={onScan} placeholder="Scan unit serials to pick" /></div>
      {scanned.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1">
          {scanned.map((s) => <span key={s} className="text-[11px] font-mono bg-stone-100 rounded px-2 py-0.5">{s}</span>)}
        </div>
      ) : (
        <div className="space-y-2">
          {(order.items || []).map((it) => {
            const pid = String(it.productId?._id || it.productId);
            return (
              <div key={pid} className="flex items-center justify-between gap-2 border border-stone-100 rounded-lg px-3 py-2">
                <div className="text-sm">
                  <span className="font-bold">{it.productId?.productName || 'Item'}</span>
                  <span className="text-stone-400 ml-2">picked {it.pickedQty || 0}/{it.quantity}</span>
                </div>
                <input type="number" min="0" placeholder="Qty" className={`${inputCls} w-24`} value={qtys[pid]} onChange={(e) => setQty(pid, e.target.value)} />
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-stone-400 my-3">{scanned.length ? `${scanned.length} unit(s) scanned` : 'Scan serials, or enter a quantity per item for non-serialized stock.'}</p>
      <PrimaryBtn onClick={submit}>Confirm Pick</PrimaryBtn>
    </Modal>
  );
};

/* ───────────── Pack ───────────── */
const PackTab = () => {
  const [orders, setOrders] = useState([]);
  const [supply, setSupply] = useState([]);
  const [packing, setPacking] = useState(null);
  const refresh = () => {
    Promise.all([getOrders({ status: 'confirmed' }), getOrders({ status: 'packed' })])
      .then(([a, b]) => setOrders([...listOf(a), ...listOf(b)])).catch(apiError);
    getSupplyOrders({ stage: 'pack' }).then((r) => setSupply(listOf(r))).catch(() => {});
  };
  useEffect(() => { refresh(); }, []);

  const packSupply = async (o) => {
    try { const r = await packSupplyOrder(o._id); toast('success', r?.message || 'Packed'); refresh(); } catch (err) { apiError(err); }
  };

  return (
    <>
      <SectionHeader>{supply.length} supply to pack</SectionHeader>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {supply.map((o) => (
          <div key={o._id} className="border border-violet-100 bg-violet-50/30 rounded-xl p-4 flex justify-between items-center">
            <div>
              <p className="font-bold text-sm flex items-center gap-2"><SupplyTag /> {supplySeller(o)}</p>
              <p className="text-xs text-stone-500">{supplyItems(o)} · picked {supplyPicked(o)}/{supplyUnits(o)}</p>
            </div>
            <PrimaryBtn onClick={() => packSupply(o)}>Pack</PrimaryBtn>
          </div>
        ))}
        {supply.length === 0 && <p className="text-sm text-stone-400 col-span-full py-2">No picked supply waiting to pack.</p>}
      </div>

      <SectionHeader>{orders.length} order(s) to pack</SectionHeader>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {orders.map((o) => (
          <div key={o._id} className="border border-stone-200 rounded-xl p-4 flex justify-between items-center">
            <div>
              <p className="font-bold text-sm">{o.invoiceNumber || o.orderNumber}</p>
              <p className="text-xs text-stone-400">{o.customerName} · {o.totalUnits} units · {o.status}</p>
            </div>
            <PrimaryBtn onClick={() => setPacking(o)}>Pack</PrimaryBtn>
          </div>
        ))}
        {orders.length === 0 && <p className="text-sm text-stone-400 col-span-full py-2 text-center">Nothing to pack.</p>}
      </div>
      {packing && <PackModal order={packing} onClose={() => setPacking(null)} onDone={() => setPacking(null)} />}
    </>
  );
};

const PackModal = ({ order, onClose, onDone }) => {
  const [scanned, setScanned] = useState([]); // serials
  const [packages, setPackages] = useState([]);
  const load = () => getPackages({ orderId: order._id }).then((r) => setPackages(listOf(r))).catch(() => {});
  useEffect(() => { load(); }, [order._id]);

  const onScan = (code) => { if (UNIT_SERIAL_RE.test(code) && !scanned.includes(code)) setScanned((s) => [...s, code]); };
  const submit = async () => {
    try {
      const product = order.items?.[0]?.productId;
      const items = scanned.length
        ? [{ productId: product, qty: scanned.length, serials: scanned }]
        : (order.items || []).map((it) => ({ productId: it.productId, qty: it.qty }));
      await createPackage({ orderId: order._id, items });
      toast('success', 'Packed'); setScanned([]); load();
    } catch (err) { apiError(err); }
  };

  return (
    <Modal title={`Pack ${order.invoiceNumber || order.orderNumber}`} onClose={onClose} wide>
      <div className="mb-3"><ScanBox onScan={onScan} placeholder="Scan unit serials into the carton" /></div>
      {scanned.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {scanned.map((s) => <span key={s} className="text-[11px] font-mono bg-stone-100 rounded px-2 py-0.5">{s}</span>)}
        </div>
      )}
      <p className="text-xs text-stone-400 mb-3">{scanned.length ? `${scanned.length} unit(s) scanned` : 'No serials scanned — will pack by quantity for non-serialized stock.'}</p>
      <PrimaryBtn onClick={submit}>Create Package</PrimaryBtn>

      {packages.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase text-stone-400 mb-1">Packages</p>
          {packages.map((p) => <div key={p._id} className="text-xs text-stone-500 font-mono py-0.5">{p.packageNumber} · {p.items.reduce((s, i) => s + i.qty, 0)} units · {p.status}</div>)}
        </div>
      )}
      <div className="mt-3 flex justify-end"><GhostBtn onClick={onDone}>Done</GhostBtn></div>
    </Modal>
  );
};

/* ───────────── Dispatch ───────────── */
const DispatchTab = () => {
  const [orders, setOrders] = useState([]);
  const [supply, setSupply] = useState([]);
  const [d, setD] = useState(null);
  const [ds, setDs] = useState(null);
  const refresh = () => {
    getOrders({ status: 'packed' }).then((r) => setOrders(listOf(r))).catch(apiError);
    getSupplyOrders({ stage: 'dispatch' }).then((r) => setSupply(listOf(r))).catch(() => {});
  };
  useEffect(() => { refresh(); }, []);
  return (
    <>
      <SectionHeader>{supply.length} supply ready to dispatch</SectionHeader>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {supply.map((o) => (
          <div key={o._id} className="border border-violet-100 bg-violet-50/30 rounded-xl p-4 flex justify-between items-center">
            <div>
              <p className="font-bold text-sm flex items-center gap-2"><SupplyTag /> {supplySeller(o)}</p>
              <p className="text-xs text-stone-500">{supplyItems(o)} · {supplyUnits(o)} units</p>
            </div>
            <PrimaryBtn onClick={() => setDs(o)}>Dispatch</PrimaryBtn>
          </div>
        ))}
        {supply.length === 0 && <p className="text-sm text-stone-400 col-span-full py-2">No packed supply waiting to dispatch.</p>}
      </div>

      <SectionHeader>{orders.length} order(s) ready to dispatch</SectionHeader>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {orders.map((o) => (
          <div key={o._id} className="border border-stone-200 rounded-xl p-4 flex justify-between items-center">
            <div>
              <p className="font-bold text-sm">{o.invoiceNumber || o.orderNumber}</p>
              <p className="text-xs text-stone-400">{o.customerName} · {o.totalUnits} units</p>
            </div>
            <PrimaryBtn onClick={() => setD(o)}>Dispatch</PrimaryBtn>
          </div>
        ))}
        {orders.length === 0 && <p className="text-sm text-stone-400 col-span-full py-2 text-center">Nothing ready to dispatch.</p>}
      </div>
      {d && <DispatchModal order={d} onClose={() => setD(null)} onDone={() => { setD(null); refresh(); }} />}
      {ds && <SupplyDispatchModal order={ds} onClose={() => setDs(null)} onDone={() => { setDs(null); refresh(); }} />}
    </>
  );
};

const DispatchModal = ({ order, onClose, onDone }) => {
  const [f, setF] = useState({ vehicleNo: '', driverName: '', driverPhone: '', transporter: '' });
  const u = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    try { await dispatchOrder({ orderId: order._id, ...f }); toast('success', 'Dispatched — stock committed'); onDone(); } catch (err) { apiError(err); }
  };
  return (
    <Modal title={`Dispatch ${order.invoiceNumber || order.orderNumber}`} onClose={onClose}>
      <p className="text-xs text-stone-400 mb-2">Commits reserved stock (it physically leaves now) and creates a shipment.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Vehicle No."><input className={inputCls} value={f.vehicleNo} onChange={u('vehicleNo')} placeholder="MP20 GA 1234" /></Field>
        <Field label="Transporter"><input className={inputCls} value={f.transporter} onChange={u('transporter')} /></Field>
        <Field label="Driver"><input className={inputCls} value={f.driverName} onChange={u('driverName')} /></Field>
        <Field label="Driver phone"><input className={inputCls} value={f.driverPhone} onChange={u('driverPhone')} /></Field>
      </div>
      <div className="mt-3"><PrimaryBtn onClick={submit}>Confirm Dispatch</PrimaryBtn></div>
    </Modal>
  );
};

const SupplyDispatchModal = ({ order, onClose, onDone }) => {
  const [f, setF] = useState({ vehicleNo: '', driverName: '', driverPhone: '', transporter: '' });
  const [labelInfo, setLabelInfo] = useState(null); // { qrPayload } — persists once the label was produced
  const [showLabel, setShowLabel] = useState(false); // is the label modal currently open
  const [busy, setBusy] = useState(false);
  const u = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const labelReady = !!labelInfo; // gate Confirm Dispatch on the label having been produced

  // Create/fetch the manifest (planned shipment + stable token), then show the
  // SAME shipping-label modal used for transfers — QR + Code128 barcode +
  // payload, printable (the print output matches the on-screen label exactly).
  const openLabel = async () => {
    if (labelInfo) { setShowLabel(true); return; } // already built — just re-open
    try {
      const r = await getSupplyManifest(order._id);
      const qrPayload = r?.data?.qrPayload;
      if (!qrPayload) { toast('error', 'Could not build the manifest'); return; }
      setLabelInfo({ qrPayload });
      setShowLabel(true);
    } catch (err) { apiError(err); }
  };
  const submit = async () => {
    setBusy(true);
    try {
      await dispatchSupplyOrder(order._id, { labelPrinted: true, ...f });
      toast('success', 'Dispatched — supply in transit');
      onDone();
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Dispatch supply · ${supplySeller(order)}`} onClose={onClose}>
      <p className="text-xs text-stone-400 mb-2">Commits the reservation (stock physically leaves now) and creates the seller shipment.</p>
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
        {!labelReady && <p className="text-[11px] text-stone-400">Open the shipping label (with the scannable QR + barcode) to enable dispatch.</p>}
      </div>
      {showLabel && labelInfo && <ManifestModal info={labelInfo} onClose={() => setShowLabel(false)} />}
    </Modal>
  );
};

export default ImsOutbound;
