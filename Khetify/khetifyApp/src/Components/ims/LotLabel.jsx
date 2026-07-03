import React from 'react';
import Barcode from '../../lib/barcode';
import { fmtDate } from '../../lib/imsApi';

/**
 * The canonical lot label — one component so the Lots → Label action, the
 * Labels page header, and the post-create success step all render an identical
 * label (product, brand/packaging, Lot, Qty, MRP, Mfg, Expiry + the
 * Code-128 of the lot number).
 */
const LotLabel = ({ lot }) => {
  const p = lot?.productId || {};
  const code = lot?.lotNumber || lot?.batchNumber || '';
  return (
    <div id="lot-label" className="border border-stone-200 rounded-xl p-5 text-center">
      <p className="font-bold text-stone-900">{p.productName || '—'}</p>
      <p className="text-xs text-stone-500 mb-1">{p.brandName || ''} {p.packagingType ? `· ${p.packagingType}` : ''}</p>
      <div className="grid grid-cols-2 gap-2 text-[11px] text-stone-500 my-3">
        <div><span className="font-bold text-stone-700">Lot:</span> {code}</div>
        <div><span className="font-bold text-stone-700">Qty:</span> {lot?.availableStock}</div>
        <div><span className="font-bold text-stone-700">MRP:</span> ₹{p.mrp || 0}</div>
        <div><span className="font-bold text-stone-700">Mfg:</span> {fmtDate(lot?.mfgDate)}</div>
        <div><span className="font-bold text-stone-700">Expiry:</span> {fmtDate(lot?.expiryDate)}</div>
      </div>
      <div className="px-2">
        <Barcode value={code} height={56} />
      </div>
      <p className="text-[10px] font-mono tracking-[0.3em] text-stone-600 mt-1">{code.toUpperCase()}</p>
    </div>
  );
};

export default LotLabel;
