import React, { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import {
  getGRNs, createGRN, receiveGRN, postGRN,
  getPutawayTasks, completePutaway,
  getWarehouses, getProducts, getPurchaseOrders, getLocations, getLots,
  fmtDate,
} from '../../../lib/imsApi';
import { Modal, Field, inputCls, PrimaryBtn, GhostBtn, Th } from './ImsUi';

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');
const listOf = (r) => (Array.isArray(r) ? r : r?.data || r?.products || []);

const GRN_STATUS = {
  draft: 'bg-stone-100 text-stone-500',
  received: 'bg-blue-50 text-blue-600',
  qc_pending: 'bg-amber-50 text-amber-600',
  putaway_pending: 'bg-purple-50 text-purple-600',
  completed: 'bg-green-50 text-green-600',
  cancelled: 'bg-red-50 text-red-600',
};

const ImsInbound = () => {
  const [tab, setTab] = useState('grn');
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-1 border-b border-stone-200">
          {[['grn', 'Goods Receipt'], ['putaway', 'Putaway']].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${
                tab === k ? 'border-[#EA2831] text-[#EA2831]' : 'border-transparent text-stone-400 hover:text-stone-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'grn' ? <GrnTab /> : <PutawayTab />}
      </div>
    </div>
  );
};

/* ───────────────────────────── GRN tab ───────────────────────────── */

const GrnTab = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [receiving, setReceiving] = useState(null);

  const refresh = () => {
    setLoading(true);
    getGRNs().then((r) => setRows(listOf(r))).catch(apiError).finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, []);

  const post = async (grn) => {
    const ok = await Swal.fire({ icon: 'question', title: `Post ${grn.grnNumber}?`, text: 'Accepted qty becomes stock; rejected qty is quarantined as damaged.', showCancelButton: true, confirmButtonColor: '#EA2831' });
    if (!ok.isConfirmed) return;
    try { const r = await postGRN(grn._id); toast('success', r?.message || 'Posted'); refresh(); }
    catch (err) { apiError(err); }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{rows.length} GRN(s)</p>
        <PrimaryBtn onClick={() => setShowCreate(true)}>
          <span className="material-symbols-outlined text-base">add</span> New GRN
        </PrimaryBtn>
      </div>

      <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-collapse min-w-[820px] resp-table">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200">
                <Th>GRN No.</Th><Th>Source</Th><Th>Warehouse</Th><Th>Lines</Th><Th>Status</Th><Th>Created</Th><Th right>Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((g) => (
                <tr key={g._id} className="hover:bg-stone-50/40">
                  <td className="px-6 py-4 text-sm font-bold text-stone-900 font-mono" data-label="GRN No.">{g.grnNumber}</td>
                  <td className="px-6 py-4 text-sm text-stone-500" data-label="Source">{g.refType}</td>
                  <td className="px-6 py-4 text-sm text-stone-500" data-label="Warehouse">{g.warehouseId?.name || '—'}</td>
                  <td className="px-6 py-4 text-sm text-stone-500" data-label="Lines">{g.lines?.length || 0}</td>
                  <td className="px-6 py-4" data-label="Status"><span className={`text-xs font-bold px-2.5 py-1 rounded-full ${GRN_STATUS[g.status]}`}>{g.status}</span></td>
                  <td className="px-6 py-4 text-sm text-stone-500" data-label="Created">{fmtDate(g.createdAt)}</td>
                  <td className="px-6 py-4 cell-actions">
                    <div className="flex items-center justify-end gap-2">
                      {['draft', 'received', 'qc_pending'].includes(g.status) && (
                        <GhostBtn onClick={() => setReceiving(g)}>Receive</GhostBtn>
                      )}
                      {['received', 'qc_pending', 'putaway_pending'].includes(g.status) && (
                        <GhostBtn onClick={() => post(g)}>Post</GhostBtn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-stone-400">No GRNs yet — create one to receive incoming stock.</td></tr>
              )}
              {loading && <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-stone-400">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && <CreateGrnModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); refresh(); }} />}
      {receiving && <ReceiveGrnModal grn={receiving} onClose={() => setReceiving(null)} onDone={() => { setReceiving(null); refresh(); }} />}
    </>
  );
};

const CreateGrnModal = ({ onClose, onDone }) => {
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [pos, setPos] = useState([]);
  const [grns, setGrns] = useState([]);
  const [lots, setLots] = useState([]);
  const [f, setF] = useState({ warehouseId: '', refType: 'Manual', refId: '' });
  const [lines, setLines] = useState([{ productId: '', expectedQty: '' }]);

  useEffect(() => {
    getWarehouses().then((r) => { const w = listOf(r); setWarehouses(w); if (w[0]) setF((s) => ({ ...s, warehouseId: w[0]._id })); }).catch(() => {});
    getProducts().then((r) => setProducts(listOf(r))).catch(() => {});
    getPurchaseOrders().then((r) => setPos(listOf(r))).catch(() => {});
    getGRNs().then((r) => setGrns(listOf(r))).catch(() => {});
    getLots().then((r) => setLots(listOf(r))).catch(() => {});
  }, []);

  // Live occupancy (sum of availableStock across lots) for the chosen warehouse
  // — mirrors the Warehouses page and the backend capacity rule.
  const warehouseOccupancy = (warehouseId) => {
    let sum = 0;
    for (const l of lots) {
      const id = String(l.warehouseId?._id || l.warehouseId || '');
      if (id === String(warehouseId) && l.availableStock > 0) sum += l.availableStock;
    }
    return sum;
  };

  const setLine = (i, k, v) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((ls) => [...ls, { productId: '', expectedQty: '' }]);
  const rmLine = (i) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  // Quantity already committed for a product across existing (non-cancelled)
  // GRNs — mirrors the backend cumulative cap so the UI shows what's really left.
  const committedFor = (productId) => {
    let sum = 0;
    for (const g of grns) {
      if (g.status === 'cancelled') continue;
      for (const l of (g.lines || [])) {
        const pid = String(l.productId?._id || l.productId || '');
        if (pid === String(productId)) sum += Number(l.expectedQty || 0);
      }
    }
    return sum;
  };
  // Stock still available to receive for a catalog product ("Other"/untracked → null = no cap).
  const availOf = (productId) => {
    if (!productId || productId === '__other__') return null;
    const p = products.find((x) => x._id === productId);
    const s = p ? Number(p.availableStock) : NaN;
    if (!Number.isFinite(s)) return null; // no cap when stock isn't tracked
    return Math.max(0, s - committedFor(productId));
  };
  // A line exceeds stock when it's a catalog product and qty > its availableStock.
  const overStock = (l) => {
    const avail = availOf(l.productId);
    return avail != null && Number(l.expectedQty) > avail;
  };
  const hasOverStock = f.refType !== 'PurchaseOrder' && lines.some((l) => l.expectedQty && overStock(l));

  const submit = async () => {
    try {
      if (hasOverStock) return toast('error', 'Quantity cannot exceed available stock');
      // Warehouse capacity pre-check (backend enforces the same rule): block a
      // GRN whose expected quantity would push the warehouse past capacity.
      const wh = warehouses.find((w) => String(w._id) === String(f.warehouseId));
      const capacity = Number(wh?.capacityUnits);
      if (f.warehouseId && Number.isFinite(capacity) && capacity > 0) {
        const totalExpected = lines.reduce((s, l) => s + Math.max(0, Number(l.expectedQty || 0)), 0);
        const space = capacity - warehouseOccupancy(f.warehouseId);
        if (totalExpected > space) {
          return toast('error', space > 0
            ? `Cannot add stock. Only ${space.toLocaleString('en-IN')} units space is available in this warehouse.`
            : 'Cannot add stock. Warehouse capacity is full. Available space is 0 units.');
        }
      }
      const body = { warehouseId: f.warehouseId, refType: f.refType };
      if (f.refType === 'PurchaseOrder' && f.refId) {
        body.refId = f.refId; // backend prefills lines from the PO
      } else {
        body.lines = lines
          .filter((l) => (l.productId === '__other__' ? (l.name || '').trim() && l.expectedQty : l.productId && l.expectedQty))
          .map((l) => (l.productId === '__other__'
            ? { name: (l.name || '').trim(), expectedQty: Number(l.expectedQty) }
            : { productId: l.productId, expectedQty: Number(l.expectedQty) }));
      }
      await createGRN(body);
      toast('success', 'GRN created');
      onDone();
    } catch (err) { apiError(err); }
  };

  return (
    <Modal title="New Goods Receipt Note" onClose={onClose} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Warehouse *">
          <select className={inputCls} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>
            {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Source">
          <select className={inputCls} value={f.refType} onChange={(e) => setF({ ...f, refType: e.target.value, refId: '' })}>
            <option value="Manual">Manual</option>
            <option value="PurchaseOrder">From Purchase Order</option>
          </select>
        </Field>
      </div>

      {f.refType === 'PurchaseOrder' ? (
        <Field label="Purchase Order">
          <select className={inputCls} value={f.refId} onChange={(e) => setF({ ...f, refId: e.target.value })}>
            <option value="">Select a PO…</option>
            {pos.map((p) => <option key={p._id} value={p._id}>{p.poNumber} · {(p.items || []).length} item(s)</option>)}
          </select>
        </Field>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-bold text-stone-500 mt-2">Expected items</p>
          {lines.map((l, i) => {
            // "__other__" lets the operator receive a product that isn't in the
            // catalog yet — the typed name is stored on the line (no productId),
            // exactly like a PO line without a product match, to be resolved at
            // receive time.
            const isOther = l.productId === '__other__';
            const avail = availOf(l.productId);
            const over = overStock(l);
            return (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1 min-w-0 space-y-2">
                  <select className={inputCls} value={l.productId} onChange={(e) => setLine(i, 'productId', e.target.value)}>
                    <option value="">Select product…</option>
                    {products.map((p) => <option key={p._id} value={p._id}>{p.productName}</option>)}
                    <option value="__other__">Other…</option>
                  </select>
                  {isOther && (
                    <input className={inputCls} placeholder="Enter product name" value={l.name || ''} onChange={(e) => setLine(i, 'name', e.target.value)} />
                  )}
                </div>
                <div className="w-24 shrink-0">
                  <input type="number" min="1" max={avail != null ? avail : undefined} placeholder="Qty" className={`${inputCls} ${over ? 'border-red-400' : ''}`} value={l.expectedQty} onChange={(e) => setLine(i, 'expectedQty', e.target.value)} />
                  {avail != null && <p className={`text-[10px] font-bold mt-1 ${over ? 'text-red-500' : 'text-stone-400'}`}>Remaining: {avail}</p>}
                </div>
                {lines.length > 1 && <GhostBtn onClick={() => rmLine(i)}>✕</GhostBtn>}
              </div>
            );
          })}
          <GhostBtn onClick={addLine}>+ Add line</GhostBtn>
        </div>
      )}

      {hasOverStock && <p className="text-xs text-red-500 font-medium mt-3">⚠ One or more items exceed the available stock.</p>}

      <div className="mt-4">
        <PrimaryBtn disabled={!f.warehouseId || (f.refType === 'PurchaseOrder' && !f.refId) || hasOverStock} onClick={submit}>Create GRN</PrimaryBtn>
      </div>
    </Modal>
  );
};

const ReceiveGrnModal = ({ grn, onClose, onDone }) => {
  const [lines, setLines] = useState(
    (grn.lines || []).map((l) => ({
      productId: l.productId?._id || l.productId || '',
      name: l.productId?.productName || l.name || '',
      expectedQty: l.expectedQty || 0,
      receivedQty: l.receivedQty || l.expectedQty || 0,
      rejectedQty: l.rejectedQty || 0,
      rejectReason: l.rejectReason || '',
      lotNumber: l.lotNumber || l.batchNumber || '',
      mfgDate: l.mfgDate ? l.mfgDate.slice(0, 10) : '',
      expiryDate: l.expiryDate ? l.expiryDate.slice(0, 10) : '',
    }))
  );
  const set = (i, k, v) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  const submit = async () => {
    try {
      await receiveGRN(grn._id, {
        lines: lines.map((l) => ({
          productId: l.productId || undefined,
          receivedQty: Number(l.receivedQty || 0),
          rejectedQty: Number(l.rejectedQty || 0),
          rejectReason: l.rejectReason || undefined,
          lotNumber: l.lotNumber || undefined,
          mfgDate: l.mfgDate || undefined,
          expiryDate: l.expiryDate || undefined,
        })),
      });
      toast('success', 'Quantities recorded');
      onDone();
    } catch (err) { apiError(err); }
  };

  return (
    <Modal title={`Receive ${grn.grnNumber}`} onClose={onClose} wide>
      <div className="space-y-3 max-h-[60vh] overflow-y-auto">
        {lines.map((l, i) => {
          const discrepancy = Number(l.receivedQty) !== Number(l.expectedQty);
          return (
            <div key={i} className="border border-stone-200 rounded-xl p-3">
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold text-sm text-stone-800">{l.name || `Line ${i + 1}`}</span>
                <span className="text-xs text-stone-400">expected <b>{l.expectedQty}</b></span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Field label="Received">
                  <input type="number" min="0" className={`${inputCls} ${discrepancy ? 'border-orange-300 bg-orange-50' : ''}`} value={l.receivedQty} onChange={(e) => set(i, 'receivedQty', e.target.value)} />
                </Field>
                <Field label="Rejected"><input type="number" min="0" className={inputCls} value={l.rejectedQty} onChange={(e) => set(i, 'rejectedQty', e.target.value)} /></Field>
                <Field label="Lot No."><input className={inputCls} value={l.lotNumber} onChange={(e) => set(i, 'lotNumber', e.target.value)} placeholder="auto if blank" /></Field>
                <Field label="Mfg"><input type="date" className={inputCls} value={l.mfgDate} onChange={(e) => set(i, 'mfgDate', e.target.value)} /></Field>
                <Field label="Expiry"><input type="date" className={inputCls} value={l.expiryDate} onChange={(e) => set(i, 'expiryDate', e.target.value)} /></Field>
              </div>
              {Number(l.rejectedQty) > 0 && (
                <Field label="Reject reason"><input className={inputCls} value={l.rejectReason} onChange={(e) => set(i, 'rejectReason', e.target.value)} placeholder="e.g. torn bags, leakage" /></Field>
              )}
              {discrepancy && <p className="text-[11px] text-orange-600 font-bold mt-1">⚠ Received ≠ expected ({l.receivedQty} vs {l.expectedQty})</p>}
            </div>
          );
        })}
      </div>
      <div className="mt-4"><PrimaryBtn onClick={submit}>Save Received Quantities</PrimaryBtn></div>
    </Modal>
  );
};

/* ─────────────────────────── Putaway tab ─────────────────────────── */

const PutawayTab = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [binsByWh, setBinsByWh] = useState({});
  const [choice, setChoice] = useState({}); // taskId -> locationId

  const refresh = () => {
    setLoading(true);
    getPutawayTasks().then((r) => setTasks(listOf(r))).catch(apiError).finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, []);

  // Load bins for each warehouse referenced by a task.
  useEffect(() => {
    const whIds = [...new Set(tasks.map((t) => t.warehouseId).filter(Boolean).map(String))];
    whIds.forEach((whId) => {
      if (binsByWh[whId]) return;
      getLocations({ warehouseId: whId, type: 'bin' })
        .then((r) => setBinsByWh((m) => ({ ...m, [whId]: listOf(r) })))
        .catch(() => {});
    });
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  const complete = async (task) => {
    const locationId = choice[task._id] || task.suggestedLocationId?._id;
    try {
      await completePutaway(task._id, locationId ? { locationId } : {});
      toast('success', 'Put away');
      refresh();
    } catch (err) { apiError(err); }
  };

  return (
    <>
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{tasks.length} pending task(s)</p>
      <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-collapse min-w-[760px] resp-table">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200">
                <Th>Product</Th><Th>Lot</Th><Th>Qty</Th><Th>Suggested</Th><Th>Destination bin</Th><Th right>Action</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {tasks.map((t) => {
                const bins = binsByWh[String(t.warehouseId)] || [];
                const selected = choice[t._id] || t.suggestedLocationId?._id || '';
                return (
                  <tr key={t._id} className="hover:bg-stone-50/40">
                    <td className="px-6 py-4 text-sm font-bold text-stone-900" data-label="Product">{t.productId?.productName || '—'}</td>
                    <td className="px-6 py-4 text-sm text-stone-500" data-label="Lot">{t.inventoryId?.lotNumber || t.inventoryId?.batchNumber || '—'}</td>
                    <td className="px-6 py-4 text-sm font-bold text-stone-700" data-label="Qty">{t.qty}</td>
                    <td className="px-6 py-4 text-xs font-mono text-stone-500" data-label="Suggested">{t.suggestedLocationId?.fullCode || '—'}</td>
                    <td className="px-6 py-4" data-label="Destination bin">
                      <select className="border border-stone-200 rounded-lg text-xs px-2 py-1.5 bg-white font-mono" value={selected} onChange={(e) => setChoice((c) => ({ ...c, [t._id]: e.target.value }))}>
                        <option value="">Select bin…</option>
                        {bins.map((b) => <option key={b._id} value={b._id}>{b.fullCode}</option>)}
                      </select>
                    </td>
                    <td className="px-6 py-4 text-right cell-actions">
                      <PrimaryBtn disabled={!selected} onClick={() => complete(t)}>Put Away</PrimaryBtn>
                    </td>
                  </tr>
                );
              })}
              {!loading && tasks.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-stone-400">No pending putaway. Post a GRN to generate tasks.</td></tr>
              )}
              {loading && <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-stone-400">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

export default ImsInbound;
