import React from 'react';
import { formatINR, fmtDate } from '../../lib/imsApi';
import { Modal, PrimaryBtn } from '../../pages/Company/ims/ImsUi';

const PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  #invoice, #invoice * { visibility: visible; }
  #invoice { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  @page { size: A4; margin: 12mm; }
}`;

/** GST-compliant invoice view for an order. Renders inside a Modal with print. */
const Invoice = ({ order, onClose }) => {
  if (!order) return null;
  const seller = localStorage.getItem('userName') || 'Your Company';
  const addr = (a) => (a ? [a.line1, a.city, a.district, a.state, a.pincode].filter(Boolean).join(', ') : '—');
  const totalCgst = (order.items || []).reduce((s, i) => s + (i.taxes?.cgst || 0), 0);
  const totalSgst = (order.items || []).reduce((s, i) => s + (i.taxes?.sgst || 0), 0);
  const totalIgst = (order.items || []).reduce((s, i) => s + (i.taxes?.igst || 0), 0);
  const grand = (order.totalAmount || 0) + (order.totalTax || 0);

  return (
    <Modal title="Tax Invoice" onClose={onClose} wide>
      <style>{PRINT_CSS}</style>
      <div className="no-print flex justify-end mb-3">
        <PrimaryBtn onClick={() => window.print()}><span className="material-symbols-outlined text-base">print</span> Print</PrimaryBtn>
      </div>
      <div id="invoice" className="text-sm text-stone-800 border border-stone-200 rounded-lg p-6">
        <div className="flex justify-between items-start border-b border-stone-200 pb-3 mb-3">
          <div>
            <h2 className="text-lg font-bold">{seller}</h2>
            <p className="text-xs text-stone-500">Tax Invoice</p>
          </div>
          <div className="text-right text-xs">
            <p><b>Invoice:</b> {order.invoiceNumber || '—'}</p>
            <p><b>Date:</b> {fmtDate(order.placedAt || order.createdAt)}</p>
            <p><b>Channel:</b> {order.salesChannel || order.channel}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4 text-xs">
          <div>
            <p className="font-bold text-stone-500 uppercase text-[10px]">Bill To</p>
            <p className="font-bold">{order.customerName || '—'}</p>
            <p className="text-stone-500">{addr(order.billingAddress)}</p>
          </div>
          <div>
            <p className="font-bold text-stone-500 uppercase text-[10px]">Ship To</p>
            <p className="text-stone-500">{addr(order.shippingAddress)}</p>
          </div>
        </div>

        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-stone-50 border-y border-stone-200 text-left">
              <th className="py-2 px-2">#</th><th className="px-2">Item</th><th className="px-2">HSN</th>
              <th className="px-2 text-right">Qty</th><th className="px-2 text-right">Rate</th>
              <th className="px-2 text-right">Taxable</th><th className="px-2 text-right">GST%</th><th className="px-2 text-right">Tax</th>
            </tr>
          </thead>
          <tbody>
            {(order.items || []).map((it, i) => {
              const t = it.taxes || {};
              const lineTax = (t.cgst || 0) + (t.sgst || 0) + (t.igst || 0);
              return (
                <tr key={i} className="border-b border-stone-100">
                  <td className="py-1.5 px-2">{i + 1}</td>
                  <td className="px-2">{it.name}</td>
                  <td className="px-2">{t.hsnCode || '—'}</td>
                  <td className="px-2 text-right">{it.qty}</td>
                  <td className="px-2 text-right">{formatINR(it.price)}</td>
                  <td className="px-2 text-right">{formatINR(t.taxable ?? it.qty * it.price)}</td>
                  <td className="px-2 text-right">{t.gstRate || 0}%</td>
                  <td className="px-2 text-right">{formatINR(lineTax)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="flex justify-end mt-4">
          <div className="w-64 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-stone-500">Taxable</span><span>{formatINR(order.totalAmount)}</span></div>
            {totalCgst > 0 && <div className="flex justify-between"><span className="text-stone-500">CGST</span><span>{formatINR(totalCgst)}</span></div>}
            {totalSgst > 0 && <div className="flex justify-between"><span className="text-stone-500">SGST</span><span>{formatINR(totalSgst)}</span></div>}
            {totalIgst > 0 && <div className="flex justify-between"><span className="text-stone-500">IGST</span><span>{formatINR(totalIgst)}</span></div>}
            <div className="flex justify-between font-bold border-t border-stone-200 pt-1 text-sm"><span>Grand Total</span><span>{formatINR(grand)}</span></div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default Invoice;
