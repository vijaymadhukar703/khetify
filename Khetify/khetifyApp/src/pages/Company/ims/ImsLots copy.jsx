import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import {
  getLots, receiveLot, createTmsShipment, dispatchShipment, getWarehouses, getWarehouseDirectory, getProducts,
  generateUnits, getUnits, markUnitsPrinted,
  getIncomingLot, confirmLotReceipt,
  daysToExpiry, expiryBadge, fmtDate,
} from '../../../lib/imsApi';
import { STATUS, statusOf, computeInventorySummary, formatINR } from '../../../lib/inventoryData';
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

/** Stock status of a lot from quantity vs reorder level — the single rule used
 *  by the Company summary cards, stock filter and table. */
/**
 * The lot's CREATED quantity = what's on the books here + what is booked to this
 * warehouse but still awaiting its Receive confirmation (inTransitStock).
 *
 * A Company → Company Warehouse lot starts fully in-transit (availableStock 0),
 * so reading availableStock alone would report the Company's own 100-unit lot as
 * 0/Out of Stock. This does NOT make pending stock available to the warehouse:
 * a warehouse-scoped caller never receives purely-pending rows (getLots
 * excludePending), and once received the qty has moved into availableStock with
 * inTransitStock back to 0 — so this reads identically for them.
 */
const lotQty = (l) => Number(l.availableStock || 0) + Number(l.inTransitStock || 0);

/**
 * ORIGINAL LOT REGISTER (Main Company only, `originalRegister`): the quantity the
 * lot was CREATED with — Inventory.originalQuantity, an immutable field written
 * once at creation. Deliberately NOT lotQty(): a lot created at 3000 that has since
 * sent 300 to another warehouse reads 2700 live, and the Company register must
 * still say 3000. Live stock stays correct on the Warehouse/Seller views, which
 * never pass this flag.
 *
 * Falls back to null (rendered "—") rather than to live stock: a row the migration
 * could not prove must read as unknown, never as a wrong-but-plausible number.
 */
const originalQty = (l) => (typeof l.originalQuantity === 'number' ? l.originalQuantity : null);
const qtyFor = (l, original) => (original ? originalQty(l) : lotQty(l));
const statusFor = (l, original) => {
  const stock = qtyFor(l, original);
  if (stock === null) return null;
  return statusOf({ stock, reorderLevel: l.lowStockThreshold || 0 });
};

const PAGE_SIZE = 10; // Company Lots pagination — lots per page

/**
 * Lots — receive stock lot-wise (lot no, mfg/expiry, warehouse) and transfer
 * lots between warehouses. The lot number is the single identity. Selling happens through
 * the Outbound flow — there is deliberately no Sell action here.
 *
 * Company-only configuration (all default to false, so every OTHER role keeps
 * the original behaviour untouched):
 *   showSummary     — render the summary cards + restocking alert above the list
 *                     and show ALL lots (incl. zero-quantity / out-of-stock)
 *                     so the card totals and the table use the same dataset.
 *   showStockStatus — add the Stock Status column + the stock-status filter.
 *   hideReceive     — hide the Receive Lot button (Create Lot is kept).
 *   paginate        — paginate the table (10/page) with Prev/Next + page numbers.
 *   showBatchNo     — add the Batch No. column + the Batch Number field in Create Lot.
 *   fluid           — widen the page: drop the max-w-7xl cap + reduce inner padding.
 *   requireWarehouse— Create/Receive Lot: make Warehouse mandatory (Unassigned
 *                     shown but disabled). Company + Company Warehouse only.
 *   hideCreate      — hide the Create Lot button (Receive Lot is kept). Company
 *                     Warehouse only: a warehouse receives stock, it never mints
 *                     a new lot — that stays with the main Company.
 *   receiveTransfer — Company Warehouse only: "Receive Lot" scans an incoming
 *                     PARENT LOT and confirms the transfer (stock arrives here)
 *                     instead of stocking in a brand-new lot.
 *   originalRegister— MAIN COMPANY only: render as the ORIGINAL LOT REGISTER —
 *                     list only lots the Company itself minted (lotOrigin
 *                     "company", so transfer-landed destination copies, warehouse
 *                     Receive-Lot and GRN lots are excluded) and read the
 *                     immutable originalQuantity instead of live stock. Off for
 *                     every other role, so the Company Warehouse view keeps
 *                     showing live balances exactly as before.
 */
const ImsLots = ({
  showSummary = false, showStockStatus = false, hideReceive = false,
  paginate = false, showBatchNo = false, fluid = false, requireWarehouse = false,
  hideCreate = false, receiveTransfer = false, originalRegister = false,
} = {}) => {
  const navigate = useNavigate();
  const [lots, setLots] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  // Destination options for transfers: ALL company warehouses (directory),
  // not just the caller's scoped list — a Katni manager sends to Khargone.
  const [warehouseDir, setWarehouseDir] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all'); // 'all'|STATUS.IN|STATUS.LOW|STATUS.OUT (Company view)
  const [page, setPage] = useState(1); // Company pagination (1-based)
  const [modal, setModal] = useState(null); // { type: 'receive'|'transfer'|'label', lot? }

  const refresh = () =>
    // The register asks the API for Company-minted lots only; every other caller
    // sends no filter and gets the full live list, unchanged.
    getLots(originalRegister ? { lotOrigin: 'company' } : {})
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
    // Company view (showSummary) lists EVERY lot — including zero-quantity /
    // out-of-stock / expired / unassigned — so the table matches Total Lots.
    // Other roles keep the original live-only (availableStock > 0) behaviour.
    let out = showSummary ? lots.slice() : lots.filter((l) => l.availableStock > 0);
    if (filter === 'expiring') out = out.filter((l) => { const d = daysToExpiry(l.expiryDate); return d !== null && d >= 0 && d <= 90; });
    else if (filter === 'expired') out = out.filter((l) => daysToExpiry(l.expiryDate) < 0);
    if (showStockStatus && stockFilter !== 'all') out = out.filter((l) => statusFor(l, originalRegister) === stockFilter);
    return out;
  }, [lots, filter, stockFilter, showSummary, showStockStatus, originalRegister]);

  // Company summary — reuse the SAME shared helper the dashboard uses, over the
  // SAME lot dataset, so the numbers can never disagree. No dummy/duplicated maths.
  const rows = useMemo(
    () =>
      lots.map((l) => {
        const p = l.productId || {};
        return {
          id: l._id,
          // Register: the ORIGINAL created quantity, so "Units in Stock" and
          // "Total Stock Value" describe the lots as created, not as they stand
          // now. An unproven row contributes 0 rather than a guess.
          stock: qtyFor(l, originalRegister) ?? 0,
          reorderLevel: l.lowStockThreshold || 0,
          price: p.mrp || 0,
        };
      }),
    [lots, originalRegister]
  );
  const summary = useMemo(() => computeInventorySummary(rows), [rows]);

  // Pagination (Company only) — applied AFTER all filters, on the filtered
  // `visible` set. Filter changes reset to page 1 via the handlers below.
  const totalPages = paginate ? Math.max(1, Math.ceil(visible.length / PAGE_SIZE)) : 1;
  const currentPage = Math.min(page, totalPages);
  const paged = paginate ? visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) : visible;
  const rangeStart = visible.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, visible.length);

  return (
    <div className={`flex-1 overflow-y-auto bg-white font-sora ${fluid ? 'p-2 sm:p-4' : 'p-4 sm:p-8'}`}>
      <div className={`space-y-6 ${fluid ? 'max-w-none' : 'max-w-7xl mx-auto'}`}>

        {/* Summary cards (Company) — COMPUTED from the live lots with the shared
            helper, so they match the dashboard exactly. */}
        {showSummary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {[
              { label: 'Total Lots', value: summary.total },
              { label: 'Low / Out of Stock', value: summary.lowStock + summary.outOfStock },
              { label: 'Units in Stock', value: rows.reduce((s, r) => s + r.stock, 0).toLocaleString('en-IN') },
              { label: 'Total Stock Value', value: formatINR(summary.stockValue) },
            ].map((stat, i) => (
              <div key={i} className="min-w-0 bg-white border border-stone-200 rounded-xl p-5 sm:p-6 shadow-sm">
                <p className="text-stone-500 text-[10px] font-bold uppercase mb-2 tracking-wider">{stat.label}</p>
                <p className="text-xl sm:text-2xl lg:text-3xl font-bold text-stone-900 break-words leading-tight tabular-nums">{stat.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {[['all', 'All Lots'], ['expiring', 'Expiring ≤ 90d'], ['expired', 'Expired']].map(([k, label]) => (
              <button
                key={k}
                onClick={() => { setFilter(k); setPage(1); }}
                className={`text-xs font-bold px-4 py-2 rounded-full border transition-colors ${
                  filter === k
                    ? 'bg-[#EA2831] border-[#EA2831] text-white'
                    : 'border-stone-200 text-stone-500 hover:bg-stone-50'
                }`}
              >
                {label}
              </button>
            ))}
            {/* Stock-status filter (Company) — operates on the SAME lot dataset and
                the SAME statusOf rule as the cards, so "Low/Out" here == the card. */}
            {showStockStatus && (
              <select
                value={stockFilter}
                onChange={(e) => { setStockFilter(e.target.value); setPage(1); }}
                className="text-xs font-bold border border-stone-200 rounded-full px-4 py-2 bg-white text-stone-600 focus:ring-[#EA2831]"
                aria-label="Filter by stock status"
              >
                <option value="all">All Stock Status</option>
                <option value={STATUS.IN}>In Stock</option>
                <option value={STATUS.LOW}>Low Stock</option>
                <option value={STATUS.OUT}>Out of Stock</option>
              </select>
            )}
          </div>
          {/* Create + Receive — both available to admin AND operations manager
              (anyone holding lot:receive). Create = manual lot; Receive = scan.
              hideReceive (main Company) hides Receive Lot only; hideCreate
              (Company Warehouse) hides Create Lot only. Neither is removed for
              any other role, and the underlying modal/API are untouched. */}
          <Can capability="lot:receive">
            <div className="flex gap-2">
              {!hideCreate && (
                <GhostBtn onClick={() => setModal({ type: 'create' })}>
                  <span className="material-symbols-outlined text-base">add_box</span> Create Lot
                </GhostBtn>
              )}
              {!hideReceive && (
                <PrimaryBtn onClick={() => setModal({ type: receiveTransfer ? 'receive-transfer' : 'receive' })}>
                  <span className="material-symbols-outlined text-base">qr_code_scanner</span> Receive Lot
                </PrimaryBtn>
              )}
            </div>
          </Can>
        </div>

        {/* Record count — the list is never silently truncated */}
        {showSummary && !loading && (
          <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
            {paginate
              ? `Showing ${rangeStart}–${rangeEnd} of ${visible.length} lots`
              : `Showing ${visible.length} of ${lots.length} lots`}
          </p>
        )}

        {/* Table */}
        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto no-scrollbar">
            <table className={`w-full text-left border-collapse resp-table ${showBatchNo ? 'min-w-[1150px]' : 'min-w-[1000px]'}`}>
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200">
                  <Th>Lot No.</Th>{showBatchNo && <Th>Batch No.</Th>}<Th>Product</Th><Th>Warehouse</Th>
                  <Th>Mfg</Th><Th>Expiry</Th><Th>Qty</Th>
                  {showStockStatus && <Th>Stock Status</Th>}
                  <Th>{showStockStatus ? 'Expiry Status' : 'Status'}</Th><Th right>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paged.map((lot) => {
                  const p = lot.productId || {};
                  const badge = expiryBadge(lot.expiryDate);
                  const qty = qtyFor(lot, originalRegister);
                  const stock = statusFor(lot, originalRegister);
                  const stockCls =
                    stock === STATUS.IN ? 'bg-green-50 text-green-700'
                    : stock === STATUS.LOW ? 'bg-orange-50 text-orange-600'
                    : stock === null ? 'bg-stone-100 text-stone-500'
                    : 'bg-red-50 text-red-600';
                  return (
                    <tr key={lot._id} className="hover:bg-stone-50/30 transition-colors">
                      <td className="px-6 py-5" data-label="Lot No.">
                        <span className="text-xs font-bold bg-stone-100 text-stone-600 px-2.5 py-1 rounded-full">
                          {lot.lotNumber || lot.batchNumber}
                        </span>
                      </td>
                      {showBatchNo && (
                        <td className="px-6 py-5 text-sm text-stone-500 font-medium" data-label="Batch No.">
                          {lot.mfgBatchNo || '—'}
                        </td>
                      )}
                      <td className="px-6 py-5" data-label="Product">
                        <p className="font-bold text-stone-900 text-sm">{p.productName || '—'}</p>
                        <p className="text-[10px] font-bold text-stone-400 uppercase">{p.category || ''}</p>
                      </td>
                      <td className="px-6 py-5 text-sm text-stone-500 font-medium" data-label="Warehouse">{lot.warehouseId?.name || 'Unassigned'}</td>
                      <td className="px-6 py-5 text-sm text-stone-500 font-medium" data-label="Mfg">{fmtDate(lot.mfgDate)}</td>
                      <td className="px-6 py-5 text-sm text-stone-500 font-medium" data-label="Expiry">{fmtDate(lot.expiryDate)}</td>
                      <td className="px-6 py-5 text-sm text-stone-900 font-bold" data-label="Qty">
                        {qty === null ? '—' : qty.toLocaleString('en-IN')}
                        {/* Only ever set on a lot the destination warehouse hasn't
                            confirmed yet — a warehouse never sees these rows. */}
                        {lot.inTransitStock > 0 && (
                          <span className="block text-[10px] font-bold text-amber-600 uppercase tracking-wide">
                            Awaiting receipt
                          </span>
                        )}
                      </td>
                      {showStockStatus && (
                        <td className="px-6 py-5" data-label="Stock Status">
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${stockCls}`}>{stock ?? 'Unknown'}</span>
                        </td>
                      )}
                      <td className="px-6 py-5" data-label={showStockStatus ? 'Expiry Status' : 'Status'}>
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
                  <tr><td colSpan={8 + (showStockStatus ? 1 : 0) + (showBatchNo ? 1 : 0)} className="px-6 py-12 text-center text-sm text-stone-400">No lots here.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination (Company) — frontend paging over the filtered lot set */}
        {paginate && !loading && visible.length > 0 && totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
              Showing {rangeStart}–{rangeEnd} of {visible.length} lots
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((n) => Math.max(1, n - 1))}
                disabled={currentPage <= 1}
                className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-base">chevron_left</span> Previous
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  className={`min-w-[36px] text-xs font-bold px-3 py-2 rounded-lg border transition-colors ${
                    n === currentPage
                      ? 'bg-[#EA2831] border-[#EA2831] text-white'
                      : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {n}
                </button>
              ))}
              <button
                onClick={() => setPage((n) => Math.min(totalPages, n + 1))}
                disabled={currentPage >= totalPages}
                className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <span className="material-symbols-outlined text-base">chevron_right</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {(modal?.type === 'receive' || modal?.type === 'create') && (
        <ReceiveLotModal products={products} warehouses={warehouses} lots={lots} scanFirst={modal.type === 'receive'}
          showBatchNo={showBatchNo} requireWarehouse={requireWarehouse}
          onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />
      )}
      {modal?.type === 'receive-transfer' && (
        <ReceiveTransferModal onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />
      )}
      {modal?.type === 'transfer' && (
        <TransferModal lot={modal.lot} warehouses={warehouseDir.length ? warehouseDir : warehouses}
          onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />
      )}
    </div>
  );
};

/* ---------- modals ---------- */

const Detail = ({ label, value }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
    <p className="text-sm text-stone-800 font-medium break-words">{value == null || value === '' ? '—' : value}</p>
  </div>
);

/**
 * RECEIVE LOT (Company Warehouse) — scan an incoming PARENT LOT booked to THIS
 * warehouse and confirm it onto the books.
 *
 * The scan only LOOKS UP the pending lot (read-only, EXACT lot match — trim +
 * uppercase only). Nothing moves on lot creation, on opening this modal, or on
 * a successful scan. The quantity lands solely in
 * POST /lots/:id/confirm-receipt (lotService.confirmLotReceipt) — one atomic
 * operation that also activates the lot's already-generated child units.
 * Confirm Receive stays disabled until an exact lot is verified, and a repeat
 * confirm is rejected ("already received"), so qty can never be added twice.
 */
const ReceiveTransferModal = ({ onClose, onDone }) => {
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);

  const onScan = async (raw) => {
    // Safe normalisation only: trim + uppercase. The backend matches EXACTLY.
    const lot = String(raw || '').trim().toUpperCase();
    if (!lot) return;
    setFound(null);
    try {
      const r = await getIncomingLot(lot);
      setFound(r?.data || null);
    } catch (err) { apiError(err); }
  };

  const confirm = async () => {
    if (!found || busy) return;
    setBusy(true);
    try {
      await confirmLotReceipt(found.inventoryId);
      toast('success', 'Received into your warehouse');
      onDone();
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  return (
    <Modal title="Receive Lot" onClose={onClose} wide>
      <div className="mb-4 bg-stone-50 border border-stone-200 rounded-xl p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-2">Scan the lot or product barcode</p>
        <ScanBox onScan={onScan} placeholder="Scan or type the parent lot number, then Enter" />
        <p className="text-[11px] text-stone-400 mt-2">
          Scan the incoming parent lot (e.g. KH-KGN-202607-0001). Nothing is added to your stock until you press Confirm Receive.
        </p>
      </div>

      {found && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 border border-stone-200 rounded-xl p-3">
            <Detail label="Parent Lot No." value={found.lotNumber} />
            <Detail label="Product" value={found.productName} />
            <Detail label="Batch No." value={found.mfgBatchNo} />
            <Detail label="Destination Warehouse" value={found.destination} />
            <Detail label="Transfer Quantity" value={Number(found.qty || 0).toLocaleString('en-IN')} />
            <Detail label="Current Status" value={String(found.status || '').replace(/_/g, ' ')} />
            <Detail label="Manufacturing Date" value={fmtDate(found.mfgDate)} />
            <Detail label="Expiry Date" value={fmtDate(found.expiryDate)} />
          </div>

          <PrimaryBtn disabled={busy} onClick={confirm}>
            <span className="material-symbols-outlined text-base">inventory</span>
            {busy ? 'Receiving…' : 'Confirm Receive'}
          </PrimaryBtn>
        </div>
      )}
    </Modal>
  );
};

const ReceiveLotModal = ({ products, warehouses, lots = [], scanFirst = false, showBatchNo = false, requireWarehouse = false, onClose, onDone }) => {
  const [f, setF] = useState({
    productId: '', warehouseId: '', lotNumber: '', mfgBatchNo: '', mfgDate: '', expiryDate: '', qty: '', lowStockThreshold: '',
  });
  const [busy, setBusy] = useState(false); // prevents accidental duplicate submission

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
    if (busy) return; // guard against a double click while the request is in flight
    // Validate required data and surface a clear message when something's missing.
    if (!f.productId || !f.qty || Number(f.qty) <= 0 || !f.mfgDate || (lotMode === 'manual' && !f.lotNumber.trim())) {
      toast('error', 'Please fill Product, Quantity, Manufacturing Date' + (lotMode === 'manual' ? ' and Lot Number.' : '.'));
      return;
    }
    // Warehouse is mandatory for Company / Company Warehouse (Unassigned is a
    // disabled placeholder there). Never enforced for roles that don't opt in.
    if (requireWarehouse && !f.warehouseId) {
      toast('error', 'Please select a Warehouse.');
      return;
    }
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
    setBusy(true);
    try {
      const res = await receiveLot({
        productId: f.productId,
        // 'auto' → send undefined so the backend mints the Khetify lot number
        // (KH-<WH>-<YYYYMM>-<seq>); 'manual' → send the operator's typed value.
        lotNumber: lotMode === 'manual' ? (f.lotNumber.trim() || undefined) : undefined,
        // Manufacturer/supplier batch number — separate optional value; trimmed.
        mfgBatchNo: f.mfgBatchNo.trim() || undefined,
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
    } catch (err) { apiError(err); } finally { setBusy(false); }
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
      {/* Batch Number — a SEPARATE optional value from the Lot Number; does not
          affect lot-number generation. Rendered only where enabled (Company). */}
      {showBatchNo && (
        <Field label="Batch Number">
          <input
            className={inputCls}
            value={f.mfgBatchNo}
            onChange={u('mfgBatchNo')}
            placeholder="Enter batch number"
          />
        </Field>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Manufacturing Date *"><input type="date" className={inputCls} value={f.mfgDate} onChange={u('mfgDate')} /></Field>
        <Field label="Expiry Date"><input type="date" className={inputCls} value={f.expiryDate} onChange={u('expiryDate')} /></Field>
        <Field label="Quantity *"><input type="number" min="1" className={inputCls} value={f.qty} onChange={u('qty')} /></Field>
        <Field label={requireWarehouse ? 'Warehouse *' : 'Warehouse'}>
          <select className={inputCls} value={f.warehouseId} onChange={u('warehouseId')}>
            {/* Unassigned stays visible but becomes a non-selectable placeholder
                when a warehouse is required (Company / Company Warehouse). */}
            <option value="" disabled={requireWarehouse}>Unassigned</option>
            {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Low-stock Alert At"><input type="number" className={inputCls} value={f.lowStockThreshold} onChange={u('lowStockThreshold')} placeholder="optional" /></Field>
      </div>
      <PrimaryBtn disabled={busy || !f.productId || !f.qty || !f.mfgDate || (lotMode === 'manual' && !f.lotNumber) || (requireWarehouse && !f.warehouseId)} onClick={submit}>
        <span className="material-symbols-outlined text-base">inventory</span> {busy ? 'Saving…' : (scanFirst ? 'Receive Lot' : 'Create Lot')}
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
  // Prefill from the CREATED quantity — a lot sent to a warehouse for receipt
  // sits in inTransitStock, so availableStock alone would prefill 0.
  const [qty, setQty] = useState(String(lotQty(lot) || ''));
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
    const serials = units.filter((x) => !x.printed).map((x) => x.serial);
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
        <p className="text-sm text-stone-500">
          Lot <b className="font-mono">{code}</b> created with {lotQty(lot)} unit(s).
          {lot.inTransitStock > 0 && ' Awaiting the warehouse’s Receive confirmation.'}
        </p>
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
