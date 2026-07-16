import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import {
  getLots, getUnits, generateUnits, markUnitsPrinted, recallLot,
} from '../../../lib/imsApi';
import { Field, inputCls, PrimaryBtn, GhostBtn, Modal } from './ImsUi';
import Barcode128 from '../../../lib/barcode128';
import LotLabel from '../../../Components/ims/LotLabel';
import { usePermission } from '../../../context/PermissionContext';

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);

// label layouts: id -> { cols, w(mm), h(mm), label }
const LAYOUTS = {
  '65': { cols: 5, w: 38, h: 21, label: '65 / page · 38×21mm' },
  '24': { cols: 3, w: 64, h: 34, label: '24 / page · 64×34mm' },
};

const PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  #label-sheet, #label-sheet * { visibility: visible; }
  #label-sheet { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  @page { size: A4; margin: 8mm; }
}`;

const ImsLabels = () => {
  const canRecall = usePermission('recall:execute');
  const [searchParams] = useSearchParams();
  const [lots, setLots] = useState([]);
  const [lotId, setLotId] = useState('');
  const [units, setUnits] = useState([]);
  const [qty, setQty] = useState(50);
  const [layout, setLayout] = useState('65');
  // Manual label size (used when layout === 'custom'): columns per row + mm.
  const [custom, setCustom] = useState({ cols: 4, w: 50, h: 30 });
  const [recallOpen, setRecallOpen] = useState(false);
  // Print scope: 'unprinted' (default) prints only not-yet-printed units so a
  // second print continues from where you left off; 'all' reprints everything.
  const [scope, setScope] = useState('unprinted');
  // Reprint range (only used in 'all' scope): blank = all, else units fromU..toU.
  const [fromU, setFromU] = useState('');
  const [toU, setToU] = useState('');

  useEffect(() => {
    getLots().then((r) => {
      const l = listOf(r);
      setLots(l);
      // Honour ?lot=<inventoryId> (e.g. from the Lots → Label action); else first lot.
      const wanted = searchParams.get('lot');
      const match = wanted && l.find((x) => x._id === wanted);
      setLotId(match ? match._id : (l[0]?._id || ''));
    }).catch(apiError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lot = useMemo(() => lots.find((l) => l._id === lotId), [lots, lotId]);

  const loadUnits = () => {
    if (!lotId) return;
    // Load the FULL set (backend caps at 10000) so large lots render completely
    // and the total-count cap below stays correct; the print sheet is filtered
    // by `scope` client-side.
    getUnits({ inventoryId: lotId, limit: 10000 }).then((r) => setUnits(listOf(r))).catch(apiError);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadUnits(); }, [lotId]);

  const generate = async () => {
    if (!canGenerate) return;
    try {
      const r = await generateUnits({ inventoryId: lotId, qty: Number(qty) });
      toast('success', r?.message || 'Generated'); loadUnits();
    } catch (err) { apiError(err); }
  };

  const print = async () => {
    window.print();
    // best-effort mark printed — the not-yet-printed units on the sheet.
    const serials = units.filter((u) => !u.printed).map((u) => u.serial);
    if (serials.length) { try { await markUnitsPrinted(serials); loadUnits(); } catch { /* ignore */ } }
  };

  // Resolve the active grid config. 'custom' reads the manual inputs (clamped to
  // sane minimums); presets come straight from LAYOUTS. Barcode height scales
  // with the label height so custom sizes flow through automatically.
  const cfg = layout === 'custom'
    ? { cols: Math.max(1, Number(custom.cols) || 1),
        w: Math.max(10, Number(custom.w) || 10),
        h: Math.max(8, Number(custom.h) || 8),
        label: 'Custom' }
    : LAYOUTS[layout];
  const bcH = Math.max(16, Math.round(cfg.h * 0.7));
  const lotLabel = (l) => `${l.productId?.productName || 'Item'} · ${l.lotNumber || l.batchNumber}`;

  // You can't label more units than the lot holds: cap generation at the lot's
  // available stock, minus what's already been labelled. The backend enforces
  // the same rule (barcodeService.generateUnits) — this is just the UX guard.
  // Cap against the lot's CREATED quantity — a lot still awaiting its warehouse
  // Receive holds its qty in inTransitStock, so availableStock alone would read
  // 0 and block labelling. Mirrors barcodeService.generateUnits' server-side cap.
  const lotQty = (l) => Number(l?.availableStock || 0) + Number(l?.inTransitStock || 0);
  const remaining = lot ? Math.max(0, lotQty(lot) - units.length) : 0;
  const qtyNum = Number(qty) || 0;
  const overCap = !!lot && qtyNum > remaining;
  const canGenerate = !!lotId && qtyNum >= 1 && !overCap && remaining > 0;

  // Numeric sequence from a serial (<lot>-<seq>). Serials are zero-padded to
  // 3 digits, so a TEXT sort puts "…-1000" before "…-997"; we sort numerically.
  const seqNum = (serial) => parseInt(String(serial).split('-').pop(), 10) || 0;

  // What actually prints: in 'unprinted' scope only the not-yet-printed units
  // (so it continues from the next number); in 'all' scope every unit (reprint),
  // optionally narrowed to a fromU..toU range. Always in TRUE numeric order.
  const visibleUnits = useMemo(() => {
    const base = scope === 'unprinted' ? units.filter((u) => !u.printed) : units;
    let list = [...base].sort((a, b) => seqNum(a.serial) - seqNum(b.serial));
    if (scope === 'all' && (fromU !== '' || toU !== '')) {
      const lo = fromU !== '' ? Number(fromU) : -Infinity;
      const hi = toU !== '' ? Number(toU) : Infinity;
      list = list.filter((u) => { const n = seqNum(u.serial); return n >= lo && n <= hi; });
    }
    return list;
  }, [units, scope, fromU, toU]);
  // first/last unit number on the sheet (visibleUnits is sorted ascending).
  const seqRange = visibleUnits.length
    ? { first: seqNum(visibleUnits[0].serial), last: seqNum(visibleUnits[visibleUnits.length - 1].serial) }
    : null;

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <style>{PRINT_CSS}</style>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Controls */}
        <div className="no-print border border-stone-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <Field label="Lot">
                <select className={inputCls} value={lotId} onChange={(e) => setLotId(e.target.value)}>
                  {lots.map((l) => <option key={l._id} value={l._id}>{lotLabel(l)} (avail {l.availableStock})</option>)}
                </select>
              </Field>
            </div>
            <Field label="Generate qty">
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setQty((q) => String(Math.max(1, (Number(q) || 0) - 1)))}
                  className="h-10 w-10 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 text-lg font-bold flex items-center justify-center"
                  title="Decrease"
                >−</button>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className={`${inputCls} w-28 text-center`}
                  value={qty}
                  placeholder="Qty"
                  // Free typing: keep only digits; allow the field to be empty
                  // while editing. Validation/cap handled by canGenerate below.
                  onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))}
                />
                <button
                  type="button"
                  onClick={() => setQty((q) => String(Math.min(remaining || 1, (Number(q) || 0) + 1)))}
                  className="h-10 w-10 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 text-lg font-bold flex items-center justify-center"
                  title="Increase"
                >+</button>
              </div>
            </Field>
            <PrimaryBtn onClick={generate} disabled={!canGenerate}>
              <span className="material-symbols-outlined text-base">qr_code_2</span> Generate Units
            </PrimaryBtn>
          </div>

          {/* Inventory cap: never label more units than the lot holds. */}
          {lot && (
            <p className={`text-[11px] ${overCap ? 'text-[#EA2831] font-semibold' : 'text-stone-400'}`}>
              {units.length.toLocaleString('en-IN')} of {lotQty(lot).toLocaleString('en-IN')} unit(s) in this lot already labelled —{' '}
              {remaining > 0
                ? <>you can generate up to <b>{remaining.toLocaleString('en-IN')}</b> more.{overCap && ' Reduce the quantity.'}</>
                : 'every unit in this lot is already labelled.'}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-stone-400">{units.length} unit(s) generated</span>
              <select className="border border-stone-200 rounded-lg text-xs px-2 py-1.5 bg-white" value={scope} onChange={(e) => setScope(e.target.value)} title="Which labels to print">
                <option value="unprinted">Unprinted only</option>
                <option value="all">All units</option>
              </select>
              <select className="border border-stone-200 rounded-lg text-xs px-2 py-1.5 bg-white" value={layout} onChange={(e) => setLayout(e.target.value)}>
                {Object.entries(LAYOUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                <option value="custom">Custom size…</option>
              </select>
              {layout === 'custom' && (
                <div className="no-print flex items-center gap-2">
                  {[
                    ['Cols', 'cols', 1],
                    ['Width (mm)', 'w', 10],
                    ['Height (mm)', 'h', 8],
                  ].map(([lbl, key, min]) => (
                    <label key={key} className="flex flex-col text-[10px] font-bold uppercase tracking-wider text-stone-400">
                      {lbl}
                      <input
                        type="number" min={min}
                        className="mt-0.5 w-16 border border-stone-200 rounded-lg text-xs px-2 py-1.5 bg-white text-stone-700"
                        value={custom[key]}
                        onChange={(e) => setCustom((c) => ({ ...c, [key]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {canRecall && lot && <GhostBtn onClick={() => setRecallOpen(true)}>Recall this lot</GhostBtn>}
              <PrimaryBtn onClick={print} disabled={visibleUnits.length === 0}>
                <span className="material-symbols-outlined text-base">print</span> Print Labels
              </PrimaryBtn>
            </div>
          </div>

          {/* Reprint range — only when reprinting (All units). */}
          {scope === 'all' && (
            <div className="flex flex-wrap items-end gap-2 border-t border-stone-100 pt-3">
              <Field label="From unit #">
                <input type="text" inputMode="numeric" pattern="[0-9]*" className={`${inputCls} w-28`} value={fromU}
                  onChange={(e) => setFromU(e.target.value.replace(/[^0-9]/g, ''))} placeholder="e.g. 1000" />
              </Field>
              <Field label="To unit #">
                <input type="text" inputMode="numeric" pattern="[0-9]*" className={`${inputCls} w-28`} value={toU}
                  onChange={(e) => setToU(e.target.value.replace(/[^0-9]/g, ''))} placeholder="e.g. 1600" />
              </Field>
              {(fromU !== '' || toU !== '') && (
                <button type="button" onClick={() => { setFromU(''); setToU(''); }} className="text-[11px] font-bold text-[#EA2831] hover:underline pb-2.5">Clear</button>
              )}
              <p className="basis-full text-[11px] text-stone-400">
                Leave blank to reprint all, or enter a range (e.g. 1000–1600) to reprint specific units you missed.
              </p>
            </div>
          )}
        </div>

        {/* Helper: what's about to print (outside #label-sheet, so it isn't printed). */}
        {lot && visibleUnits.length > 0 && (
          <p className="no-print text-[11px] text-stone-500">
            Printing <b>{visibleUnits.length.toLocaleString('en-IN')}</b> label(s)
            {seqRange ? <> (units {seqRange.first}–{seqRange.last})</> : null}
          </p>
        )}

        {/* Printable label sheet */}
        <div id="label-sheet">
          {/* Shared lot label header — identical to the Lots section + post-create label. */}
          {lot && (
            <div className="mb-4 max-w-sm break-inside-avoid">
              <LotLabel lot={lot} />
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cfg.cols}, ${cfg.w}mm)`, gap: '2mm' }}>
            {visibleUnits.map((u) => (
              <div key={u.serial} style={{ width: `${cfg.w}mm`, height: `${cfg.h}mm` }}
                className="border border-stone-300 rounded-sm p-1 flex flex-col items-center justify-center overflow-hidden break-inside-avoid">
                <p className="text-[7px] font-bold text-stone-800 leading-tight text-center truncate w-full">{lot ? (lot.productId?.productName || 'Item') : ''}</p>
                <p className="text-[6px] text-stone-500 leading-tight">{u.lotNumber}</p>
                <Barcode128 value={u.serial} height={bcH} width={1} className="w-full" />
                <p className="text-[6px] font-mono text-stone-700 leading-tight">{u.serial}</p>
              </div>
            ))}
          </div>
          {visibleUnits.length === 0 && (
            <p className="no-print text-sm text-stone-400 py-10 text-center">
              {units.length === 0
                ? 'No units yet — generate some to print labels.'
                : scope === 'unprinted'
                  ? 'All units are already printed. Switch to “All units” to reprint.'
                  : 'No units match that range.'}
            </p>
          )}
        </div>
      </div>

      {recallOpen && lot && (
        <RecallModal lot={lot} onClose={() => setRecallOpen(false)} onDone={() => { setRecallOpen(false); loadUnits(); }} />
      )}
    </div>
  );
};

const RecallModal = ({ lot, onClose, onDone }) => {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const ok = await Swal.fire({ icon: 'warning', title: `Recall lot ${lot.lotNumber || lot.batchNumber}?`, text: 'All not-yet-sold units will be blocked from picking.', showCancelButton: true, confirmButtonColor: '#EA2831' });
    if (!ok.isConfirmed) return;
    setBusy(true);
    try { const r = await recallLot(lot.lotNumber || lot.batchNumber); setResult(r?.data); toast('success', r?.message || 'Recalled'); }
    catch (err) { apiError(err); } finally { setBusy(false); }
  };
  return (
    <Modal title="Recall Lot" onClose={onClose} wide>
      {!result ? (
        <>
          <p className="text-sm text-stone-600 mb-4">This blocks all not-yet-sold units of <b>{lot.lotNumber || lot.batchNumber}</b> and lists everywhere the lot has reached.</p>
          <PrimaryBtn disabled={busy} onClick={run}>{busy ? 'Recalling…' : 'Execute Recall'}</PrimaryBtn>
        </>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex gap-4">
            <div className="bg-red-50 text-red-700 rounded-lg px-3 py-2 font-bold">{result.recalledUnits} recalled</div>
            <div className="bg-amber-50 text-amber-700 rounded-lg px-3 py-2 font-bold">{result.soldUnits} already sold</div>
          </div>
          <div>
            <p className="font-bold text-stone-700 mb-1">Stock still held</p>
            {result.stock?.map((s, i) => (
              <div key={i} className="text-xs text-stone-500 border-b border-dashed border-stone-100 py-1">
                {s.warehouse}: avail {s.availableStock}, damaged {s.damagedStock}
                {s.bins?.length > 0 && <span className="ml-2 font-mono">[{s.bins.map((b) => `${b.bin}:${b.qty}`).join(', ')}]</span>}
              </div>
            ))}
          </div>
          <div>
            <p className="font-bold text-stone-700 mb-1">Customers / orders reached</p>
            {result.customers?.length ? result.customers.map((c, i) => (
              <div key={i} className="text-xs text-stone-500 py-0.5">{c.orderNumber} · {c.customerName || '—'}</div>
            )) : <p className="text-xs text-stone-400">None recorded.</p>}
          </div>
          <PrimaryBtn onClick={onDone}>Done</PrimaryBtn>
        </div>
      )}
    </Modal>
  );
};

export default ImsLabels;
