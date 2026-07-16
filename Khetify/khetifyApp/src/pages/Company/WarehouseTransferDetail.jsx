import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getShipmentDetails, formatINR } from '../../lib/imsApi';
import BackButton from '../../Components/BackButton';
import { usePermission } from '../../context/PermissionContext';

// WAREHOUSE TRANSFER DETAIL — read-only traceability for ONE transfer: what
// moved, which PARENT LOTS it came from, and the EXACT child serials it carried.
// Serials come from the real UnitEvent audit trail (see shipmentService
// .shipmentDetails); none are ever synthesised. Warehouse scope is enforced
// server-side. This page writes nothing.

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtNum = (n) => Number(n || 0).toLocaleString('en-IN');
const UNITS_PER_PAGE = 50;

const unitStatusStyle = (s) => {
  if (['in_stock', 'generated', 'printed'].includes(s)) return 'bg-stone-100 text-stone-600';
  if (['picked', 'packed'].includes(s)) return 'bg-blue-50 text-blue-700';
  if (s === 'shipped') return 'bg-violet-50 text-violet-700';
  if (['sold', 'returned'].includes(s)) return 'bg-green-50 text-green-700';
  return 'bg-stone-100 text-stone-600';
};

const Detail = ({ label, value }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
    <p className="text-sm text-stone-800 font-medium break-words">{value == null || value === '' ? '—' : value}</p>
  </div>
);

const Card = ({ title, children }) => (
  <section className="bg-white border border-stone-200 rounded-xl p-4 sm:p-5">
    <h2 className="text-sm font-bold text-stone-900 mb-3">{title}</h2>
    {children}
  </section>
);

const WarehouseTransferDetail = () => {
  const { id } = useParams();
  const { warehouseIds } = usePermission();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    getShipmentDetails(id)
      .then((r) => setD(r?.data || null))
      .catch((e) => setErr(e?.response?.data?.message || 'Could not load this transfer.'));
  }, [id]);

  if (err) return <div className="w-full px-3 sm:px-5 py-6 font-sora"><BackButton /><p className="mt-6 text-sm text-stone-500">{err}</p></div>;
  if (!d) return <div className="w-full px-3 sm:px-5 py-6 font-sora"><BackButton /><p className="mt-6 text-sm text-stone-400">Loading…</p></div>;

  const s = d.summary || {};
  const mine = (warehouseIds || []).map(String);
  const direction = mine.includes(String(s.fromWarehouseId)) ? 'Outgoing'
    : mine.includes(String(s.toWarehouseId)) ? 'Incoming' : '—';

  return (
    <div className="w-full px-3 sm:px-5 py-6 font-sora space-y-4">
      <BackButton />
      <div>
        <h1 className="text-2xl font-bold text-stone-900 mb-1">Transfer {s.ref}</h1>
        <p className="text-stone-500">{s.source} → {s.destination}</p>
      </div>

      <Card title="Transfer Summary">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
          <Detail label="Reference" value={s.ref} />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Direction</p>
            <span className={`inline-block mt-0.5 text-[11px] font-bold rounded-full px-2.5 py-1 ${
              direction === 'Outgoing' ? 'bg-orange-50 text-orange-600' : direction === 'Incoming' ? 'bg-blue-50 text-blue-700' : 'bg-stone-100 text-stone-500'
            }`}>{direction}</span>
          </div>
          <Detail label="Source" value={s.source} />
          <Detail label="Destination" value={s.destination} />
          <Detail label="Product" value={(s.products || []).join(', ')} />
          <Detail label="Quantity" value={fmtNum(s.quantity)} />
          <Detail label="Total Value" value={formatINR(s.value)} />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Status</p>
            <span className="inline-block mt-0.5 text-[11px] font-bold rounded-full px-2.5 py-1 bg-stone-100 text-stone-600 capitalize">
              {String(s.status || '').replace(/_/g, ' ')}
            </span>
          </div>
          <Detail label="Created" value={fmtDate(s.createdAt)} />
          <Detail label="Picked" value={fmtDateTime(s.pickedAt)} />
          <Detail label="Dispatched" value={fmtDateTime(s.dispatchedAt)} />
          <Detail label="Received" value={fmtDateTime(s.receivedAt)} />
        </div>
      </Card>

      {(d.parentLots || []).map((l, i) => <ParentLotCard key={i} lot={l} />)}

      {(d.timeline || []).length > 0 && (
        <Card title="Timeline">
          <div className="flex flex-wrap items-center gap-2">
            {d.timeline.map((t, i) => (
              <React.Fragment key={i}>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
                  <span className="h-2 w-2 rounded-full bg-[#EA2831]" />
                  <span className="capitalize">{String(t.status || '').replace(/_/g, ' ')}</span>
                  <span className="text-stone-400 font-normal">{fmtDateTime(t.at)}</span>
                </div>
                {i < d.timeline.length - 1 && <span className="text-stone-300">→</span>}
              </React.Fragment>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

/** One parent lot + the exact child units this transfer carried (search + paged). */
const ParentLotCard = ({ lot }) => {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const units = useMemo(() => lot.units || [], [lot.units]);
  const filtered = useMemo(() => {
    const n = q.trim().toUpperCase();
    return n ? units.filter((u) => String(u.serial).toUpperCase().includes(n)) : units;
  }, [units, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / UNITS_PER_PAGE));
  const current = Math.min(page, totalPages);
  const start = filtered.length === 0 ? 0 : (current - 1) * UNITS_PER_PAGE + 1;
  const end = Math.min(current * UNITS_PER_PAGE, filtered.length);
  const paged = filtered.slice((current - 1) * UNITS_PER_PAGE, current * UNITS_PER_PAGE);

  return (
    <Card title={`Parent Lot · ${lot.lotNumber}`}>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3 mb-4">
        <Detail label="Parent Lot No." value={<span className="font-mono text-xs">{lot.lotNumber}</span>} />
        <Detail label="Batch No." value={lot.mfgBatchNo} />
        <Detail label="Product" value={lot.productName} />
        <Detail label="Qty Allocated" value={fmtNum(lot.allocatedQty)} />
        <Detail label="Received Qty" value={lot.receivedQty == null ? '—' : fmtNum(lot.receivedQty)} />
        <Detail label="Manufacturing Date" value={fmtDate(lot.mfgDate)} />
        <Detail label="Expiry Date" value={fmtDate(lot.expiryDate)} />
      </div>

      <div className="border-t border-stone-100 pt-3">
        {units.length === 0 ? (
          <p className="text-sm text-stone-400">No child units picked yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <p className="text-xs font-bold text-stone-700">This transfer used these child units from this parent lot.</p>
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search serial…"
                className="text-xs border border-stone-200 rounded-lg px-3 py-1.5 bg-white min-w-[180px]" />
            </div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-2">
              Showing {start}–{end} of {filtered.length} child units
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[820px]">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200">
                    {['Child Serial', 'Parent Lot No.', 'Status', 'Picked At', 'Dispatched At', 'Received At', 'Owner'].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-[10px] font-bold text-stone-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {paged.map((u) => (
                    <tr key={u.serial} className="hover:bg-stone-50/60">
                      <td className="px-4 py-2.5 font-mono text-xs text-stone-800">{u.serial}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-stone-500">{u.lotNumber || lot.lotNumber}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 capitalize ${unitStatusStyle(u.status)}`}>
                          {String(u.status || '').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{fmtDateTime(u.pickedAt)}</td>
                      <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{fmtDateTime(u.dispatchedAt)}</td>
                      <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{fmtDateTime(u.receivedAt)}</td>
                      <td className="px-4 py-2.5 text-xs text-stone-500 capitalize">{u.owner || '—'}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-stone-400">No serial matches that search.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-end gap-1 mt-3">
                <button onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={current <= 1}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed">Previous</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button key={n} onClick={() => setPage(n)}
                    className={`min-w-[32px] text-xs font-bold px-2.5 py-1.5 rounded-lg border transition-colors ${
                      n === current ? 'bg-[#EA2831] border-[#EA2831] text-white' : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                    }`}>{n}</button>
                ))}
                <button onClick={() => setPage((n) => Math.min(totalPages, n + 1))} disabled={current >= totalPages}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
};

export default WarehouseTransferDetail;
