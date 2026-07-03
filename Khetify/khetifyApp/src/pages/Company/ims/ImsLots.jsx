import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import {
  getLots, receiveLot, createTmsShipment, dispatchShipment, getWarehouses, getWarehouseDirectory, getProducts,
  generateUnits, getUnits, markUnitsPrinted,
  daysToExpiry, expiryBadge, fmtDate,
} from '../../../lib/imsApi';
import { Modal, Field, inputCls, PrimaryBtn, GhostBtn, Th } from './ImsUi';
import { ManifestModal } from '../../../Components/ims/TransferModals';
import LotLabel from '../../../Components/ims/LotLabel';
import Barcode128 from '../../../lib/barcode128';
import ScanBox from '../../../Components/ims/ScanBox';
import Can from '../../../Components/ims/Can';

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });

const apiError = (err) =>
  toast('error', err?.response?.data?.message || err.message || 'Something went wrong');

/**
 * Lots — receive stock lot-wise (lot no, mfg/expiry, warehouse) and transfer
 * lots between warehouses. The lot number is the single identity. Selling happens through
 * the Outbound flow — there is deliberately no Sell action here.
 */
const ImsLots = () => {
  const navigate = useNavigate();
  const [lots, setLots] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  // Destination options for transfers: ALL company warehouses (directory),
  // not just the caller's scoped list — a Katni manager sends to Khargone.
  const [warehouseDir, setWarehouseDir] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null); // { type: 'receive'|'transfer'|'label', lot? }

  const refresh = () =>
    getLots()
      .then((res) => res?.success && setLots(res.data))
      .catch(apiError)
      .finally(() => setLoading(false));

  useEffect(() => {
    refresh();
    getWarehouses().then((r) => r?.success && setWarehouses(r.data)).catch(() => {});
    getWarehouseDirectory().then((r) => setWarehouseDir(Array.isArray(r) ? r : r?.data || [])).catch(() => {});
    getProducts().then((r) => setProducts(r?.data || r?.products || [])).catch(() => {});
  }, []);

  const visible = useMemo(() => {
    const live = lots.filter((l) => l.availableStock > 0);
    if (filter === 'expiring') return live.filter((l) => { const d = daysToExpiry(l.expiryDate); return d !== null && d >= 0 && d <= 90; });
    if (filter === 'expired') return live.filter((l) => daysToExpiry(l.expiryDate) < 0);
    return live;
  }, [lots, filter]);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex gap-2">
            {[['all', 'All Lots'], ['expiring', 'Expiring ≤ 90d'], ['expired', 'Expired']].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`text-xs font-bold px-4 py-2 rounded-full border transition-colors ${
                  filter === k
                    ? 'bg-[#EA2831] border-[#EA2831] text-white'
                    : 'border-stone-200 text-stone-500 hover:bg-stone-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Create + Receive — both available to admin AND operations manager
              (anyone holding lot:receive). Create = manual lot; Receive = scan. */}
          <Can capability="lot:receive">
            <div className="flex gap-2">
              <GhostBtn onClick={() => setModal({ type: 'create' })}>
                <span className="material-symbols-outlined text-base">add_box</span> Create Lot
              </GhostBtn>
              <PrimaryBtn onClick={() => setModal({ type: 'receive' })}>
                <span className="material-symbols-outlined text-base">qr_code_scanner</span> Receive Lot
              </PrimaryBtn>
            </div>
          </Can>
        </div>

        {/* Table */}
        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[1000px] resp-table">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200">
                  <Th>Lot No.</Th><Th>Product</Th><Th>Warehouse</Th>
                  <Th>Mfg</Th><Th>Expiry</Th><Th>Qty</Th><Th>Status</Th><Th right>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {visible.map((lot) => {
                  const p = lot.productId || {};
                  const badge = expiryBadge(lot.expiryDate);
                  return (
                    <tr key={lot._id} className="hover:bg-stone-50/30 transition-colors">
                      <td className="px-6 py-5" data-label="Lot No.">
                        <span className="text-xs font-bold bg-stone-100 text-stone-600 px-2.5 py-1 rounded-full">
                          {lot.lotNumber || lot.batchNumber}
                        </span>
                      </td>
                      <td className="px-6 py-5" data-label="Product">
                        <p className="font-bold text-stone-900 text-sm">{p.productName || '—'}</p>
                        <p className="text-[10px] font-bold text-stone-400 uppercase">{p.category || ''}</p>
                      </td>
                      <td className="px-6 py-5 text-sm text-stone-500 font-medium" data-label="Warehouse">{lot.warehouseId?.name || 'Unassigned'}</td>
                      <td className="px-6 py-5 text-sm text-stone-500 font-medium" data-label="Mfg">{fmtDate(lot.mfgDate)}</td>
                      <td className="px-6 py-5 text-sm text-stone-500 font-medium" data-label="Expiry">{fmtDate(lot.expiryDate)}</td>
                      <td className="px-6 py-5 text-sm text-stone-900 font-bold" data-label="Qty">{lot.availableStock.toLocaleString('en-IN')}</td>
                      <td className="px-6 py-5" data-label="Status">
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-6 py-5 cell-actions">
                        <div className="flex items-center justify-end gap-2">
                          <Can capability="inventory:transfer">
                            <GhostBtn onClick={() => setModal({ type: 'transfer', lot })}>
                              <span className="material-symbols-outlined text-sm">sync_alt</span> Transfer
                            </GhostBtn>
                          </Can>
                          <GhostBtn onClick={() => navigate(`/ims/labels?lot=${lot._id}`)}>
                            <span className="material-symbols-outlined text-sm">qr_code_2</span> Label
                          </GhostBtn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && visible.length === 0 && (
                  <tr><td colSpan={8} className="px-6 py-12 text-center text-sm text-stone-400">No lots here.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {(modal?.type === 'receive' || modal?.type === 'create') && (
        <ReceiveLotModal products={products} warehouses={warehouses} lots={lots} scanFirst={modal.type === 'receive'}
          onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />
      )}
      {modal?.type === 'transfer' && (
        <TransferModal lot={modal.lot} warehouses={warehouseDir.length ? warehouseDir : warehouses}
          onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />
      )}
    </div>
  );
};

/* ---------- modals ---------- */

const ReceiveLotModal = ({ products, warehouses, lots = [], scanFirst = false, onClose, onDone }) => {
  const [f, setF] = useState({
    productId: '', warehouseId: '', lotNumber: '', mfgDate: '', expiryDate: '', qty: '', lowStockThreshold: '',
  });

  // Live occupancy per warehouse (sum of availableStock across its lots) — the
  // same figure the Warehouses page shows. Used to pre-check capacity before we
  // hit the API; the backend enforces the same rule authoritatively.
  const occByWarehouse = useMemo(() => {
    const map = {};
    for (const l of lots) {
      const id = String(l.warehouseId?._id || l.warehouseId || '');
      if (!id) continue;
      map[id] = (map[id] || 0) + (l.availableStock > 0 ? l.availableStock : 0);
    }
    return map;
  }, [lots]);
  // After a successful create we switch the modal into a success state offering
  // one-tap label printing / unit-barcode generation for the new lot.
  const [created, setCreated] = useState(null);
  // Lot numbering: 'auto' → Khetify generates KH-<WH>-<YYYYMM>-<seq> on save;
  // 'manual' → the operator types the lot number.
  const [lotMode, setLotMode] = useState('auto');
  const u = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Scan a barcode / QR (USB scanner or device camera). If the code matches a
  // product SKU we auto-select that product; otherwise we treat it as the lot
  // number. Mirrors the scan flow used in warehouse transfers.
  const onScan = (code) => {
    const c = String(code || '').trim();
    if (!c) return;
    const norm = c.toLowerCase();
    const match = products.find(
      (p) => [p.skuNumber, p.barcode, p.hsnCode].filter(Boolean).some((v) => String(v).toLowerCase() === norm)
    );
    if (match) {
      setF((prev) => ({ ...prev, productId: match._id }));
      toast('success', `Product matched: ${match.productName}`);
    } else {
      // A scanned lot code is a manual lot number — surface the field.
      setLotMode('manual');
      setF((prev) => ({ ...prev, lotNumber: prev.lotNumber || c }));
      toast('success', `Lot code captured: ${c}`);
    }
  };

  const submit = async () => {
    // Capacity pre-check: block a lot that would push the chosen warehouse past
    // its capacity, and tell the operator exactly how much room is left. The
    // backend enforces the same rule, so this is UX only, never the guarantee.
    const wh = warehouses.find((w) => String(w._id) === String(f.warehouseId));
    const capacity = Number(wh?.capacityUnits);
    if (f.warehouseId && Number.isFinite(capacity) && capacity > 0) {
      const current = occByWarehouse[String(f.warehouseId)] || 0;
      const space = capacity - current;
      if (Number(f.qty) > space) {
        toast('error', space > 0
          ? `Cannot add stock. Only ${space.toLocaleString('en-IN')} units space is available in this warehouse.`
          : 'Cannot add stock. Warehouse capacity is full. Available space is 0 units.');
        return;
      }
    }
    try {
      const res = await receiveLot({
        productId: f.productId,
        // 'auto' → send undefined so the backend mints the Khetify lot number
        // (KH-<WH>-<YYYYMM>-<seq>); 'manual' → send the operator's typed value.
        lotNumber: lotMode === 'manual' ? (f.lotNumber || undefined) : undefined,
        warehouseId: f.warehouseId || null,
        mfgDate: f.mfgDate || null,
        expiryDate: f.expiryDate || null,
        qty: Number(f.qty),
        lowStockThreshold: f.lowStockThreshold ? Number(f.lowStockThreshold) : undefined,
      });
      toast('success', 'Lot received into stock');
      const inv = res?.data;
      if (inv) {
        // Enrich with the chosen product (the API returns an unpopulated
        // productId) so the lot label renders name / brand / MRP immediately.
        const prod = products.find((p) => String(p._id) === String(f.productId));
        setCreated({ ...inv, productId: prod || inv.productId });
      } else {
        onDone();
      }
    } catch (err) { apiError(err); }
  };

  // Success state: print the lot label and/or generate unit barcodes in place.
  if (created) return <CreatedLotSuccess lot={created} onDone={onDone} />;

  return (
    <Modal title={scanFirst ? 'Receive Lot — scan or enter' : 'Create Lot'} onClose={onClose} wide>
      {scanFirst && (
        <div className="mb-4 bg-stone-50 border border-stone-200 rounded-xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-2">Scan the lot or product barcode</p>
          <ScanBox onScan={onScan} placeholder="Scan barcode / QR, or type a code then Enter" />
          <p className="text-[11px] text-stone-400 mt-2">
            Use a USB scanner or the camera button. A matching product is selected automatically; any other code fills the lot number.
          </p>
        </div>
      )}
      <Field label="Product">
        <select className={inputCls} value={f.productId} onChange={u('productId')}>
          <option value="">Select product…</option>
          {products.map((p) => (
            <option key={p._id} value={p._id}>{p.productName} {p.packagingType ? `(${p.packagingType})` : ''}</option>
          ))}
        </select>
      </Field>
      <Field label="Lot Number">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setLotMode('auto'); setF((prev) => ({ ...prev, lotNumber: '' })); }}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-bold border transition-colors ${
              lotMode === 'auto'
                ? 'bg-[#EA2831] border-[#EA2831] text-white'
                : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
            }`}
          >
            <span className="material-symbols-outlined text-base">auto_awesome</span> Khetify-generated
          </button>
          <button
            type="button"
            onClick={() => setLotMode('manual')}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-bold border transition-colors ${
              lotMode === 'manual'
                ? 'bg-[#EA2831] border-[#EA2831] text-white'
                : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
            }`}
          >
            <span className="material-symbols-outlined text-base">keyboard</span> Enter manually
          </button>
        </div>
        {lotMode === 'manual' ? (
          <input
            className={`${inputCls} mt-2`}
            value={f.lotNumber}
            onChange={u('lotNumber')}
            placeholder="Enter the lot number for this received lot"
          />
        ) : (
          <p className="mt-2 text-[11px] text-stone-400">
            Khetify will assign a unique number (KH-&lt;WH&gt;-&lt;YYYYMM&gt;-&lt;seq&gt;) when you save.
          </p>
        )}
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Manufacturing Date *"><input type="date" className={inputCls} value={f.mfgDate} onChange={u('mfgDate')} /></Field>
        <Field label="Expiry Date"><input type="date" className={inputCls} value={f.expiryDate} onChange={u('expiryDate')} /></Field>
        <Field label="Quantity *"><input type="number" min="1" className={inputCls} value={f.qty} onChange={u('qty')} /></Field>
        <Field label="Warehouse">
          <select className={inputCls} value={f.warehouseId} onChange={u('warehouseId')}>
            <option value="">Unassigned</option>
            {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Low-stock Alert At"><input type="number" className={inputCls} value={f.lowStockThreshold} onChange={u('lowStockThreshold')} placeholder="optional" /></Field>
      </div>
      <PrimaryBtn disabled={!f.productId || !f.qty || !f.mfgDate || (lotMode === 'manual' && !f.lotNumber)} onClick={submit}>
        <span className="material-symbols-outlined text-base">inventory</span> {scanFirst ? 'Receive Lot' : 'Create Lot'}
      </PrimaryBtn>
    </Modal>
  );
};

const TransferModal = ({ lot, warehouses, onClose, onDone }) => {
  const srcId = String(lot.warehouseId?._id || lot.warehouseId || '');
  const dest = warehouses.filter((w) => String(w._id) !== srcId);
  // Dispatch now is ON by default — the sender creates AND dispatches in one
  // step and gets the manifest QR right here, never opening Operations.
  const [f, setF] = useState({ toWarehouseId: dest[0]?._id || '', qty: lot.availableStock, dispatchNow: true });
  const [busy, setBusy] = useState(false);
  const [manifest, setManifest] = useState(null); // { qrPayload } once dispatched
  const submit = async () => {
    const destWh = warehouses.find((w) => String(w._id) === String(f.toWarehouseId));
    if (!destWh) return;
    setBusy(true);
    try {
      // Warehouse-to-warehouse transfers go through the full shipment workflow.
      // This creates a PLANNED transfer shipment; stock isn't deducted yet.
      const res = await createTmsShipment({
        refType: 'Transfer',
        toType: 'warehouse',
        fromWarehouseId: srcId || null,
        toWarehouseId: f.toWarehouseId,
        toLabel: destWh.name,
        lines: [{ inventoryId: lot._id, qty: Number(f.qty) }],
      });
      const id = res?.data?._id || res?._id;
      if (f.dispatchNow && id) {
        // Dispatch immediately: deducts source (in-transit) and mints the
        // manifest QR. The receiving code is pushed to the destination — we
        // only show the QR/barcode here for the sender to print/share.
        const dres = await dispatchShipment(id);
        const info = dres?.data || dres;
        toast('success', 'Transfer dispatched — stock is now in transit');
        setManifest({ qrPayload: info?.qrPayload });
        return; // keep the modal open showing the manifest; onDone runs on its close
      }
      toast('success', 'Transfer shipment created — dispatch it from Operations → Shipment Tracking');
      onDone();
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  // Once dispatched, swap the form for the manifest; closing it refreshes the list.
  if (manifest) return <ManifestModal info={manifest} onClose={onDone} />;

  return (
    <Modal title={`Transfer Lot ${lot.lotNumber || lot.batchNumber}`} onClose={onClose}>
      <p className="text-sm text-stone-500 mb-4">
        {lot.productId?.productName} — {lot.availableStock} units at {lot.warehouseId?.name || 'Unassigned'}
      </p>
      <Field label="Destination Warehouse">
        <select className={inputCls} value={f.toWarehouseId} onChange={(e) => setF({ ...f, toWarehouseId: e.target.value })}>
          <option value="">Select warehouse…</option>
          {dest.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
        </select>
      </Field>
      <Field label="Quantity">
        <input type="number" min="1" max={lot.availableStock} className={inputCls}
          value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
      </Field>
      <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
        <input type="checkbox" className="h-4 w-4 accent-[#EA2831]"
          checked={f.dispatchNow} onChange={(e) => setF({ ...f, dispatchNow: e.target.checked })} />
        <span className="text-sm font-medium text-stone-700">Dispatch now (print the shipping label here)</span>
      </label>
      <div className="text-[11px] text-stone-500 bg-stone-50 border border-stone-200 rounded-lg p-3 mb-4">
        {f.dispatchNow
          ? <>This <b>dispatches</b> the transfer immediately: stock moves in-transit and the shipping label appears here to print/share. The destination warehouse <b>scans the label to receive</b> it.</>
          : <>This creates a planned transfer shipment. Dispatch it later from Operations → Shipment Tracking; the destination then <b>scans the label to receive</b> it into stock.</>}
      </div>
      <PrimaryBtn disabled={!f.toWarehouseId || !f.qty || busy} onClick={submit}>
        <span className="material-symbols-outlined text-base">local_shipping</span>
        {busy ? (f.dispatchNow ? 'Dispatching…' : 'Creating…') : (f.dispatchNow ? 'Dispatch Transfer' : 'Create Transfer Shipment')}
      </PrimaryBtn>
    </Modal>
  );
};


/* Print only the lot label / unit sheet, not the whole modal chrome. */
const CREATED_PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  #created-print, #created-print * { visibility: visible; }
  #created-print { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  @page { size: A4; margin: 8mm; }
}`;

const UNIT_LAYOUT = { cols: 5, w: 38, h: 21 }; // mirrors the ImsLabels "65/page" layout

/**
 * Shown right after Create Lot — the fewest-steps path to labels: print the lot
 * label and/or generate unit barcodes (prefilled to the lot quantity) and print
 * the unit sheet, without leaving the flow. Reuses the shared LotLabel and the
 * same Barcode128 unit layout as the Labels page.
 */
const CreatedLotSuccess = ({ lot, onDone }) => {
  const [qty, setQty] = useState(String(lot.availableStock || ''));
  const [units, setUnits] = useState([]);
  const [busy, setBusy] = useState(false);
  const code = lot.lotNumber || lot.batchNumber || '';

  const generate = async () => {
    const n = Number(qty);
    if (!n || n < 1) return;
    setBusy(true);
    try {
      await generateUnits({ inventoryId: lot._id, qty: n });
      const r = await getUnits({ inventoryId: lot._id });
      setUnits(Array.isArray(r) ? r : r?.data || []);
      toast('success', 'Unit barcodes generated');
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  const print = async () => {
    window.print();
    const serials = units.filter((x) => x.status === 'generated').map((x) => x.serial);
    if (serials.length) { try { await markUnitsPrinted(serials); } catch { /* best-effort */ } }
  };

  return (
    <Modal title="Lot created" onClose={onDone} wide>
      <style>{CREATED_PRINT_CSS}</style>
      <div id="created-print">
        <LotLabel lot={lot} />
        {units.length > 0 && (
          <div className="mt-4" style={{ display: 'grid', gridTemplateColumns: `repeat(${UNIT_LAYOUT.cols}, ${UNIT_LAYOUT.w}mm)`, gap: '2mm' }}>
            {units.map((unit) => (
              <div key={unit.serial} style={{ width: `${UNIT_LAYOUT.w}mm`, height: `${UNIT_LAYOUT.h}mm` }}
                className="border border-stone-300 rounded-sm p-1 flex flex-col items-center justify-center overflow-hidden break-inside-avoid">
                <p className="text-[7px] font-bold text-stone-800 leading-tight text-center truncate w-full">{lot.productId?.productName || 'Item'}</p>
                <p className="text-[6px] text-stone-500 leading-tight">{unit.lotNumber}</p>
                <Barcode128 value={unit.serial} height={20} width={1} className="w-full" />
                <p className="text-[6px] font-mono text-stone-700 leading-tight">{unit.serial}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="no-print mt-4 space-y-3">
        <p className="text-sm text-stone-500">Lot <b className="font-mono">{code}</b> created with {lot.availableStock} unit(s) in stock.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Unit barcodes to generate">
            <input
              type="text" inputMode="numeric" pattern="[0-9]*"
              className={`${inputCls} w-28`} value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </Field>
          <GhostBtn onClick={generate} disabled={busy || !Number(qty)}>
            <span className="material-symbols-outlined text-base">qr_code_2</span>
            {busy ? 'Generating…' : (units.length ? 'Re-generate' : 'Generate unit barcodes')}
          </GhostBtn>
        </div>
        <div className="flex justify-end gap-2">
          <GhostBtn onClick={onDone}>Done</GhostBtn>
          <PrimaryBtn onClick={print}>
            <span className="material-symbols-outlined text-base">print</span> Print {units.length ? 'labels' : 'lot label'}
          </PrimaryBtn>
        </div>
      </div>
    </Modal>
  );
};

export default ImsLots;
