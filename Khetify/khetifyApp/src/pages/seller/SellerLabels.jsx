import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import Barcode128 from '../../lib/barcode128';
import ScanBox from '../../Components/ims/ScanBox';
import { Field, inputCls, PrimaryBtn } from '../Company/ims/ImsUi';
import { getSellerLink, getSellerLots, getSellerUnits, printSellerUnits, sellerScan } from '../../lib/sellerApi';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
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
  #seller-label-sheet, #seller-label-sheet * { visibility: visible; }
  #seller-label-sheet { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  @page { size: A4; margin: 8mm; }
}`;

// Seller Labels — VIEW, (re)PRINT and SCAN the unit labels the seller received
// via supply. There is NO "Generate Units": sellers never mint serials.
const SellerLabels = () => {
  const [params] = useSearchParams();
  const [approved, setApproved] = useState(null);
  const [lots, setLots] = useState([]);
  const [lotId, setLotId] = useState('');
  const [units, setUnits] = useState([]);
  const [layout, setLayout] = useState('65');
  const [custom, setCustom] = useState({ cols: 4, w: 50, h: 30 });
  const [scanResult, setScanResult] = useState(null);

  useEffect(() => {
    getSellerLink()
      .then((r) => {
        const ok = r?.data?.linkStatus === 'approved';
        setApproved(ok);
        if (!ok) return;
        getSellerLots().then((res) => {
          const l = listOf(res);
          setLots(l);
          const wanted = params.get('lot');
          const match = wanted && l.find((x) => x._id === wanted);
          setLotId(match ? match._id : (l[0]?._id || ''));
        }).catch(apiError);
      })
      .catch(() => setApproved(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUnits = (id) => {
    if (!id) { setUnits([]); return; }
    getSellerUnits({ inventoryId: id, limit: 10000 }).then((r) => setUnits(listOf(r))).catch(apiError);
  };
  useEffect(() => { if (approved && lotId) loadUnits(lotId); }, [lotId, approved]);

  const lot = useMemo(() => lots.find((l) => l._id === lotId), [lots, lotId]);
  const lotLabel = (l) => `${l.productId?.productName || 'Item'} · ${l.lotNumber || l.batchNumber}`;

  const cfg = layout === 'custom'
    ? { cols: Math.max(1, Number(custom.cols) || 1), w: Math.max(10, Number(custom.w) || 10), h: Math.max(8, Number(custom.h) || 8), label: 'Custom' }
    : LAYOUTS[layout];
  const bcH = Math.max(16, Math.round(cfg.h * 0.7));

  const seqNum = (serial) => parseInt(String(serial).split('-').pop(), 10) || 0;
  const visibleUnits = useMemo(() => [...units].sort((a, b) => seqNum(a.serial) - seqNum(b.serial)), [units]);

  const print = async () => {
    window.print();
    const serials = visibleUnits.map((u) => u.serial);
    if (serials.length) { try { await printSellerUnits(serials); loadUnits(lotId); } catch { /* ignore */ } }
  };

  const doScan = async (code) => {
    try { const r = await sellerScan(code); setScanResult(r?.data); } catch (err) { apiError(err); setScanResult(null); }
  };

  if (approved === null) return <div className="flex-1 p-8 text-center text-stone-400 font-sora">Loading…</div>;
  if (!approved) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">lock</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Labels are locked</h2>
          <p className="text-sm text-amber-700 mt-1">Available after your supplying company approves you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <style>{PRINT_CSS}</style>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-stone-900">Labels</h1>
          <p className="text-sm text-stone-500">Print and scan the unit labels you received from your supplying company. Serials are assigned by the company.</p>
        </div>

        {/* Scan panel */}
        <div className="no-print border border-stone-200 rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-bold text-stone-500 mb-2">Scan a unit / lot</p>
          <ScanBox onScan={doScan} />
          {scanResult && (
            <div className="mt-3 text-sm bg-stone-50 rounded-lg p-3">
              <span className="font-bold uppercase text-[10px] tracking-wide text-stone-400 mr-2">{scanResult.type}</span>
              {scanResult.type === 'unit' && <span>{scanResult.unit.serial} · <b>{scanResult.unit.status}</b> · {scanResult.unit.productId?.productName}</span>}
              {scanResult.type === 'lot' && <span>{scanResult.lot} · {scanResult.rows?.length} row(s)</span>}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="no-print border border-stone-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <Field label="Lot">
                <select className={inputCls} value={lotId} onChange={(e) => setLotId(e.target.value)}>
                  {lots.map((l) => <option key={l._id} value={l._id}>{lotLabel(l)} (avail {l.availableStock})</option>)}
                  {lots.length === 0 && <option value="">No lots yet</option>}
                </select>
              </Field>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-stone-400">{units.length} unit label(s)</span>
              <select className="border border-stone-200 rounded-lg text-xs px-2 py-1.5 bg-white" value={layout} onChange={(e) => setLayout(e.target.value)}>
                {Object.entries(LAYOUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                <option value="custom">Custom size…</option>
              </select>
              {layout === 'custom' && (
                <div className="no-print flex items-center gap-2">
                  {[['Cols', 'cols', 1], ['Width (mm)', 'w', 10], ['Height (mm)', 'h', 8]].map(([lbl, key, min]) => (
                    <label key={key} className="flex flex-col text-[10px] font-bold uppercase tracking-wider text-stone-400">
                      {lbl}
                      <input type="number" min={min} className="mt-0.5 w-16 border border-stone-200 rounded-lg text-xs px-2 py-1.5 bg-white text-stone-700"
                        value={custom[key]} onChange={(e) => setCustom((c) => ({ ...c, [key]: e.target.value }))} />
                    </label>
                  ))}
                </div>
              )}
            </div>
            <PrimaryBtn onClick={print} disabled={visibleUnits.length === 0}>
              <span className="material-symbols-outlined text-base">print</span> Print Labels
            </PrimaryBtn>
          </div>
          {lot && visibleUnits.length > 0 && (
            <p className="text-[11px] text-stone-500">Printing <b>{visibleUnits.length.toLocaleString('en-IN')}</b> label(s).</p>
          )}
        </div>

        {/* Printable sheet */}
        <div id="seller-label-sheet">
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
              {units.length === 0 ? 'No unit labels for this lot — they arrive when your company supplies labeled stock.' : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SellerLabels;
