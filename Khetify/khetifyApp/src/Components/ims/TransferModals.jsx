import React, { lazy, Suspense, useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { verifyShipment, getLots } from '../../lib/imsApi';
import { usePermission } from '../../context/PermissionContext';
import { Modal, PrimaryBtn, GhostBtn, Th } from '../../pages/Company/ims/ImsUi';
import ScanBox from './ScanBox';
import CameraScanner, { cameraScanSupported } from './CameraScanner';
import QrCode from '../../lib/qrcode';

// Lazy-loaded so the barcode library only loads when a manifest/receive modal
// opens — callers (shipment board, Lots, Hub) never depend on it to render.
const Barcode128 = lazy(() => import('../../lib/barcode128'));

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);

const getPos = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve({});
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => resolve({}), { timeout: 5000 }
  );
});

// Print only the label block — everything else on the page is hidden.
const LABEL_PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  #shipping-label, #shipping-label * { visibility: visible; }
  #shipping-label { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  @page { margin: 12mm; }
}`;

/**
 * Shipping label (QR + Barcode) for a dispatched transfer. Re-openable any time
 * after dispatch from the row "Shipping Label" button, the Hub, or the
 * create+dispatch flow. Receiving needs only this QR + destination-warehouse
 * validation. Includes a Print action that prints just the label.
 */
export function ManifestModal({ info, onClose }) {
  return (
    <Modal title="Shipping Label" onClose={onClose}>
      <style>{LABEL_PRINT_CSS}</style>
      <p className="no-print text-sm text-stone-600 mb-3">
        Print or show this shipping label to the receiving side. They scan it at the destination
        warehouse to receive the stock — no code needed.
      </p>
      <div id="shipping-label" className="text-center border border-stone-200 rounded-xl p-4">
        {/* QR is what the receiving CAMERA scans (the 1D strip below stays for
            keyboard-wedge scanners and as a fallback). */}
        <div className="flex justify-center mb-2">
          <QrCode value={info.qrPayload} size={180} />
        </div>
        <Suspense fallback={<div className="h-12" />}>
          <Barcode128 value={info.qrPayload} height={48} className="w-full" />
        </Suspense>
        <p className="text-[10px] font-mono text-stone-500 mt-1 break-all">{info.qrPayload}</p>
      </div>
      <div className="no-print mt-3 flex justify-end gap-2">
        <GhostBtn onClick={onClose}>Done</GhostBtn>
        <PrimaryBtn onClick={() => window.print()}>
          <span className="material-symbols-outlined text-base">print</span> Print Label
        </PrimaryBtn>
      </div>
    </Modal>
  );
}

/**
 * Transfer receipt verification (proof of delivery):
 *   1. SCAN the manifest barcode — device camera or keyboard-wedge scanner.
 *   2. WAREHOUSE VALIDATION: the scanned shipment's destination must equal
 *      the logged-in user's assigned warehouse — otherwise "Access Denied —
 *      Wrong Warehouse" and the receive button stays disabled. (The backend
 *      enforces the same rule.)
 *   3. The lots on board are shown (lot, product, qty, source → destination).
 *   4. Receive — barcode scan + destination-warehouse validation are sufficient.
 */
export function ReceiveModal({ shipment, onClose, onDone }) {
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [products, setProducts] = useState({}); // inventoryId -> product name
  // CAMERA-FIRST: clicking "Receive Lot" opens the device camera right away
  // (where supported) — the barcode is traced, then validated against the
  // shipment and the manager's warehouse before anything else happens.
  const [showCamera, setShowCamera] = useState(cameraScanSupported());
  const { warehouseIds } = usePermission();

  // Resolve product names for the lots on board (lines carry inventoryId/lotNumber/qty).
  useEffect(() => {
    getLots().then((r) => {
      const map = {};
      listOf(r).forEach((lot) => { map[lot._id] = lot.productId?.productName; });
      setProducts(map);
    }).catch(() => {});
  }, []);

  const destId = String(shipment.toWarehouseId?._id || shipment.toWarehouseId || '');
  const scanned = !!qr.trim();
  const scanMatches = scanned && qr.trim().startsWith(`${shipment._id}.`);
  // Warehouse validation: scanned lot destination === user's assigned warehouse.
  // Unscoped users (admin / unassigned) pass automatically.
  const warehouseOk = !warehouseIds?.length || warehouseIds.includes(destId);
  const verified = scanMatches && warehouseOk;

  const run = async () => {
    setBusy(true);
    try {
      const pos = await getPos();
      await verifyShipment(shipment._id, {
        qr: qr.trim(),
        warehouseId: destId || undefined,
        ...pos,
      });
      toast('success', 'Receipt verified — stock updated');
      onDone();
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Receive Lot — ${shipment.toLabel}`} onClose={onClose} wide>
      <p className="text-xs text-stone-400 mb-3">
        Only the destination warehouse can receive. Scan the shipping label — the system
        validates it against your assigned warehouse before the receive button activates.
      </p>

      {/* Step 1 — barcode scan: camera opens automatically; wedge/manual as fallback */}
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">1 · Scan shipping label</p>
      <ScanBox onScan={(code) => setQr(code)} placeholder="Scan the shipping label barcode / QR" autoFocus={!scanned && !showCamera} />
      {showCamera && (
        <CameraScanner
          hint="Point the camera at the shipping label barcode"
          onClose={() => setShowCamera(false)}
          onDetected={(code) => { setShowCamera(false); setQr(code); }}
        />
      )}
      {scanned && !scanMatches && (
        <p className="mt-1 text-[11px] font-mono break-all text-red-600">✕ {qr} — does not match this shipment</p>
      )}
      {scanMatches && !warehouseOk && (
        <div className="mt-2 border border-red-200 bg-red-50 rounded-xl p-3 text-center">
          <p className="text-sm font-bold text-red-700">Access Denied — Wrong Warehouse</p>
          <p className="text-xs text-red-500 mt-0.5">This transfer is destined for another warehouse. Only its assigned operations manager can receive it.</p>
        </div>
      )}
      {verified && (
        <p className="mt-1 text-[11px] font-bold text-green-600">✓ Verification successful — destination matches your warehouse</p>
      )}

      {/* Lots on board */}
      {verified && (
        <div className="mt-3 border border-stone-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-stone-50 border-b border-stone-200 flex items-center justify-between text-[11px] text-stone-500">
            <span><b className="text-stone-900">{shipment.fromLabel || 'Source'}</b> → <b className="text-stone-900">{shipment.toLabel}</b></span>
            <span>{(shipment.lines || []).length} lot(s) in transit</span>
          </div>
          <table className="w-full text-left border-collapse text-sm">
            <thead><tr className="text-[10px] uppercase text-stone-400"><Th>Lot</Th><Th>Product</Th><Th right>Qty</Th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {(shipment.lines || []).map((l, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 font-mono text-xs font-bold">{l.lotNumber || l.batchNumber || '—'}</td>
                  <td className="px-4 py-2 text-xs text-stone-600">{products[l.inventoryId] || '—'}</td>
                  <td className="px-4 py-2 text-xs text-right">{l.qty}</td>
                </tr>
              ))}
              {(!shipment.lines || !shipment.lines.length) && (
                <tr><td colSpan={3} className="px-4 py-4 text-center text-xs text-stone-400">No lines on this shipment.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Step 2 — receive */}
      {verified && (
        <div className="mt-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">2 · Confirm receipt</p>
          <div className="flex items-end gap-2">
            <PrimaryBtn disabled={busy} onClick={run}>
              {busy ? 'Receiving…' : 'Receive — Mark Received'}
            </PrimaryBtn>
          </div>
        </div>
      )}
    </Modal>
  );
}
