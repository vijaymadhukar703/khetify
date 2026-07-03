import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { State, City } from 'country-state-city';
import { Modal, Field, inputCls, PrimaryBtn } from '../Company/ims/ImsUi';
import { getSellerLink, getSellerWarehouses, getSellerWarehouseStockSummary, getSellerLots, createSellerWarehouse, updateSellerWarehouse, SELLER_FEATURES } from '../../lib/sellerApi';
import { getSellerSocket } from '../../lib/socket';
import { useSellerSubscription } from '../../context/SellerSubscriptionContext';
import { useSellerPermission } from '../../context/SellerPermissionContext';

const fmtUnits = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const occupancyInfo = (units, capacity) => {
  if (!capacity) return null;
  const pct = Math.round((units / capacity) * 1000) / 10;
  return {
    pct,
    pctLabel: Number.isInteger(pct) ? String(pct) : pct.toFixed(1),
    barWidth: Math.min(100, pct),
    over: Math.max(0, units - capacity),
  };
};

const OTHER_CITY = '__other__';
const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });

// Seller Warehouses — mirrors the company warehouse module (pages/Company/ims/
// ImsWarehouses.jsx) but is scoped to the seller via the seller API client.
// Gated by approval: an unapproved seller sees a locked panel (the backend also
// enforces this via requireApprovedSeller). Seller lots arrive in Phase 4, so
// per-warehouse occupancy is omitted for now.
const SellerWarehouses = () => {
  const navigate = useNavigate();
  const { sellerCan } = useSellerSubscription();
  const canCreate = useSellerPermission('warehouse:create'); // seller_admin only
  const [approved, setApproved] = useState(null); // null = loading
  const [warehouses, setWarehouses] = useState([]);
  const [lots, setLots] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [liveBump, setLiveBump] = useState(0); // nudges the open detail modal to refetch on a live event

  // Free sellers get exactly 1 warehouse; a 2nd needs the paid plan. Show an
  // Upgrade prompt instead of letting the create hit the backend limit error.
  const atFreeLimit = !sellerCan(SELLER_FEATURES.MULTI_WAREHOUSE) && warehouses.length >= 1;
  const onAdd = () => {
    if (atFreeLimit) {
      Swal.fire({
        icon: 'info', title: 'Upgrade to add more warehouses',
        text: 'Your free plan includes 1 warehouse. Upgrade to Pro for unlimited warehouses.',
        showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'View plans',
      }).then((res) => { if (res.isConfirmed) navigate('/seller/billing'); });
      return;
    }
    setShowCreate(true);
  };

  const refresh = useCallback(() => {
    getSellerWarehouses().then((r) => { if (r?.success) setWarehouses(r.data); }).catch(() => {});
    getSellerLots({}).then((r) => { if (r?.success) setLots(r.data || []); }).catch(() => {});
  }, []);

  const load = useCallback(() => {
    getSellerLink()
      .then((r) => {
        const ok = r?.data?.linkStatus === 'approved';
        setApproved(ok);
        if (ok) refresh();
      })
      .catch(() => setApproved(false));
  }, [refresh]);
  useEffect(() => { load(); }, [load]);

  // Live stock updates: when a supply lands into one of the seller's warehouses
  // (verifyReceipt → emitToSeller), refresh the cards' occupancy and nudge the
  // open detail modal to refetch — no manual refresh. Fires for the seller's
  // own device too (their socket is in the same room).
  useEffect(() => {
    if (!approved) return undefined;
    const s = getSellerSocket();
    if (!s) return undefined;
    const onInv = () => { refresh(); setLiveBump((n) => n + 1); };
    s.on('seller:inventory:update', onInv);
    return () => { s.off('seller:inventory:update', onInv); };
  }, [approved, refresh]);

  if (approved === null) {
    return <div className="flex-1 p-8 text-center text-stone-400 font-sora">Loading…</div>;
  }

  if (!approved) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">lock</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Warehouses are locked</h2>
          <p className="text-sm text-amber-700 mt-1">Available after your supplying company approves you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
            {warehouses.length} warehouse(s)
          </p>
          {/* Adding a warehouse is a seller_admin action — the warehouse manager
              operates within their assigned warehouse(s) but can't create one. */}
          {canCreate && (
            <PrimaryBtn onClick={onAdd}>
              <span className="material-symbols-outlined text-base">{atFreeLimit ? 'workspace_premium' : 'add_business'}</span> Add Warehouse
            </PrimaryBtn>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {warehouses.map((w) => {
            const info = occupancyInfo(w.usedUnits, w.capacityUnits);
            const warehouseLots = lots.filter((l) => String(l.warehouseId?._id || l.warehouseId) === String(w._id));
            return (
              <div key={w._id} role="button" tabIndex={0}
                onClick={() => setDetail(w)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail(w); } }}
                className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm cursor-pointer hover:shadow-md hover:border-[#EA2831]/40 transition-all">
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <h3 className="font-bold text-stone-900">{w.name}</h3>
                    <p className="text-xs text-stone-400">{[w.address?.city, w.address?.state].filter(Boolean).join(', ') || w.code || '—'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canCreate && (
                      <button
                        type="button"
                        title="Edit warehouse"
                        onClick={(e) => { e.stopPropagation(); setEditing(w); }}
                        className="text-stone-400 hover:text-[#EA2831] transition-colors"
                      >
                        <span className="material-symbols-outlined text-[20px]">edit</span>
                      </button>
                    )}
                    <span className="material-symbols-outlined text-stone-300">warehouse</span>
                  </div>
                </div>
                <div className="flex justify-between text-xs font-bold mb-1.5">
                  <span className="text-stone-900">{fmtUnits(w.usedUnits)} units</span>
                  {info ? (
                    <span className={info.over > 0 ? 'text-red-600' : 'text-stone-400'}>
                      {info.pctLabel}% of {fmtUnits(w.capacityUnits)}
                    </span>
                  ) : <span className="text-stone-400">No capacity</span>}
                </div>
                {info && (
                  <>
                    <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden mb-1">
                      <div
                        className={`h-full rounded-full ${info.over > 0 ? 'bg-red-500' : info.pct > 85 ? 'bg-red-500' : info.pct > 60 ? 'bg-orange-400' : 'bg-green-500'}`}
                        style={{ width: `${info.barWidth}%` }}
                      />
                    </div>
                    {info.over > 0 && (
                      <p className="text-[10px] font-bold text-red-600 mb-2">
                        Over capacity by {fmtUnits(info.over)} units
                      </p>
                    )}
                  </>
                )}
                <div className="mt-3 space-y-1.5">
                  {warehouseLots.slice(0, 4).map((l) => (
                    <div key={l._id} className="flex justify-between text-xs border-b border-dashed border-stone-100 pb-1.5">
                      <span className="text-stone-500 truncate pr-2">
                        {l.productId?.productName || l.productName || '—'} · <b>{l.lotNumber || l.batchNumber || '—'}</b>
                      </span>
                      <span className="font-bold text-stone-900">{fmtUnits(l.availableStock || 0)}</span>
                    </div>
                  ))}
                  {warehouseLots.length === 0 && <p className="text-xs text-stone-300">Empty</p>}
                  {warehouseLots.length > 4 && <p className="text-[10px] text-stone-400">+{warehouseLots.length - 4} more lots</p>}
                </div>
                {!w.isActive && <span className="inline-block mt-3 text-[10px] font-bold uppercase tracking-wider text-stone-400 bg-stone-100 rounded-full px-2 py-0.5">Inactive</span>}
              </div>
            );
          })}
          {warehouses.length === 0 && (
            <p className="text-sm text-stone-400 col-span-full py-10 text-center">
              {canCreate ? 'No warehouses yet — add your first one.' : 'No warehouses assigned to you yet.'}
            </p>
          )}
        </div>
      </div>

      {detail && (
        <WarehouseDetailModal
          warehouse={detail}
          version={liveBump}
          canViewLots={sellerCan(SELLER_FEATURES.INVENTORY_VIEW)}
          onViewLots={() => {
            if (sellerCan(SELLER_FEATURES.INVENTORY_VIEW)) { navigate('/seller/inventory'); return; }
            Swal.fire({
              icon: 'info', title: 'Lot detail is a Pro feature',
              text: 'Upgrade to view per-lot stock and batches for this warehouse.',
              showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'View plans',
            }).then((r) => { if (r.isConfirmed) navigate('/seller/billing'); });
          }}
          onClose={() => setDetail(null)}
        />
      )}
      {showCreate && (
        <CreateWarehouseModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); refresh(); }} />
      )}
      {editing && (
        <CreateWarehouseModal
          warehouse={editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
};

const Meta = ({ label, value }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
    <p className="text-sm font-bold text-stone-800 break-words">{value}</p>
  </div>
);

// Read-only seller warehouse detail — mirrors the company WarehouseDetail:
// profile + occupancy bar + the full lot list (paid; aggregate-only on free).
const WarehouseDetailModal = ({ warehouse: w, version, canViewLots, onViewLots, onClose }) => {
  const addr = [w.address?.line1, w.address?.city, w.address?.district, w.address?.state, w.address?.pincode]
    .filter(Boolean).join(', ');
  const [sum, setSum] = useState(null); // { usedUnits, lotCount, capacity, usedPct } — works on any plan
  const [lots, setLots] = useState(null); // the seller's OWN lot rows in this warehouse (paid)

  // Fetch on open and whenever `version` bumps (a live stock event / receive).
  useEffect(() => {
    let cancelled = false;
    getSellerWarehouseStockSummary(w._id).then((r) => { if (!cancelled && r?.success) setSum(r.data); }).catch(() => {});
    if (canViewLots) {
      getSellerLots({ warehouseId: w._id }).then((r) => { if (!cancelled && r?.success) setLots(r.data || []); }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [w._id, version, canViewLots]);

  const capacity = sum?.capacity ?? w.capacityUnits ?? null;
  const summaryPct = sum?.usedPct ?? w.usedPct ?? null;
  // Prefer live lot totals (paid); fall back to the aggregate summary (free).
  const lotUnits = lots ? lots.reduce((s, l) => s + (l.availableStock || 0), 0) : null;
  const used = canViewLots && lotUnits != null ? lotUnits : (sum?.usedUnits ?? w.usedUnits ?? 0);
  const pct = capacity ? Math.min(100, Math.round((used / capacity) * 1000) / 10) : summaryPct;

  return (
    <Modal title={w.name} onClose={onClose} wide>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Meta label="Code" value={w.code || '—'} />
        <Meta label="Location" value={addr || '—'} />
        <Meta label="Capacity" value={capacity ? `${fmtUnits(capacity)} units` : '—'} />
        <Meta label="In stock" value={`${fmtUnits(used)} units`} />
      </div>

      {pct !== null && (
        <div className="mb-5">
          <div className="flex justify-between text-xs font-bold mb-1.5">
            <span className="text-stone-500">Occupancy</span>
            <span className={pct > 85 ? 'text-red-600' : pct > 60 ? 'text-orange-600' : 'text-stone-400'}>{pct}% of {fmtUnits(capacity)}</span>
          </div>
          <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-orange-400' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
          </div>
          {pct > 100 && (
            <p className="text-[10px] font-bold text-red-600 mt-1.5">Over capacity by {fmtUnits(Math.max(0, used - capacity))} units</p>
          )}
        </div>
      )}

      {canViewLots ? (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">
            Lots in this warehouse ({lots ? lots.length : '…'})
          </p>
          <div className="border border-stone-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm min-w-[520px] resp-table">
                <thead>
                  <tr className="bg-stone-50 text-[10px] uppercase text-stone-400">
                    <th className="px-4 py-2 font-bold">Product</th>
                    <th className="px-4 py-2 font-bold">Lot No.</th>
                    <th className="px-4 py-2 font-bold">Expiry</th>
                    <th className="px-4 py-2 font-bold text-right">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {(lots || []).map((l) => (
                    <tr key={l._id}>
                      <td data-label="Product" className="px-4 py-2 text-stone-700">{l.productId?.productName || '—'}</td>
                      <td data-label="Lot No." className="px-4 py-2 font-mono text-xs font-bold text-stone-900">{l.lotNumber || l.batchNumber || '—'}</td>
                      <td data-label="Expiry" className="px-4 py-2 text-xs text-stone-500">{l.expiryDate ? fmtDate(l.expiryDate) : '—'}</td>
                      <td data-label="Qty" className="px-4 py-2 text-right font-bold text-stone-900">{(l.availableStock ?? 0).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                  {lots && lots.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-stone-400">No stock in this warehouse.</td></tr>
                  )}
                  {!lots && (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-stone-400">Loading lots…</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="border border-amber-200 bg-amber-50/50 rounded-xl p-4 text-center">
          <span className="material-symbols-outlined text-amber-500 text-3xl">lock</span>
          <p className="text-sm font-bold text-amber-800 mt-1">Per-lot detail is a Pro feature</p>
          <p className="text-xs text-amber-700 mt-0.5">Occupancy is shown above. Upgrade to see every lot (product · lot no. · qty · expiry) in this warehouse.</p>
          <button onClick={onViewLots} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-white bg-[#EA2831] hover:bg-red-600 rounded-lg px-4 py-2">
            <span className="material-symbols-outlined text-base">workspace_premium</span> Upgrade to view lots
          </button>
        </div>
      )}
    </Modal>
  );
};

const CreateWarehouseModal = ({ warehouse, onClose, onDone }) => {
  const [f, setF] = useState({
    name: warehouse?.name || '',
    code: warehouse?.code || '',
    city: warehouse?.address?.city || '',
    state: warehouse?.address?.state || '',
    pincode: warehouse?.address?.pincode || '',
    capacityUnits: warehouse?.capacityUnits || '',
  });
  const u = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Dependent State → City dropdowns (data ships with country-state-city, no API).
  // We STORE the full names (f.state / f.city); stateIso only drives the city list.
  const states = React.useMemo(() => State.getStatesOfCountry('IN'), []);
  const [stateIso, setStateIso] = useState('');
  const cities = React.useMemo(() => (stateIso ? City.getCitiesOfState('IN', stateIso) : []), [stateIso]);
  const [cityChoice, setCityChoice] = useState('');
  const [otherCity, setOtherCity] = useState('');

  const onStateChange = (e) => {
    const iso = e.target.value;
    const name = states.find((s) => s.isoCode === iso)?.name || '';
    setStateIso(iso);
    setCityChoice('');
    setOtherCity('');
    setF((prev) => ({ ...prev, state: name, city: '' }));
  };
  const onCityChange = (e) => {
    const v = e.target.value;
    setCityChoice(v);
    setF((prev) => ({ ...prev, city: v === OTHER_CITY ? otherCity : v }));
  };
  const onOtherCity = (e) => {
    const v = e.target.value;
    setOtherCity(v);
    setF((prev) => ({ ...prev, city: v }));
  };

  const submit = async () => {
    try {
      const body = {
        name: f.name,
        code: f.code,
        address: { city: f.city, state: f.state, pincode: f.pincode },
        capacityUnits: f.capacityUnits ? Number(f.capacityUnits) : undefined,
      };
      if (warehouse) {
        await updateSellerWarehouse(warehouse._id, body);
        toast('success', 'Warehouse updated');
      } else {
        await createSellerWarehouse(body);
        toast('success', 'Warehouse created');
      }
      onDone();
    } catch (err) {
      toast('error', err?.response?.data?.message || 'Could not save warehouse');
    }
  };
  return (
    <Modal title="Add Warehouse" onClose={onClose}>
      <Field label="Name *"><input className={inputCls} value={f.name} onChange={u('name')} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Code"><input className={inputCls} value={f.code} onChange={u('code')} placeholder="WH-JBP" /></Field>
        <Field label="Capacity (units)"><input type="number" className={inputCls} value={f.capacityUnits} onChange={u('capacityUnits')} /></Field>
        <Field label="State *">
          <select className={inputCls} value={stateIso} onChange={onStateChange}>
            <option value="">Select state…</option>
            {states.map((s) => <option key={s.isoCode} value={s.isoCode}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="City *">
          <select className={inputCls} value={cityChoice} onChange={onCityChange} disabled={!stateIso}>
            <option value="">{stateIso ? 'Select city…' : 'Select a state first'}</option>
            {cities.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            <option value={OTHER_CITY}>Other…</option>
          </select>
        </Field>
      </div>
      {cityChoice === OTHER_CITY && (
        <Field label="Enter city"><input className={inputCls} value={otherCity} onChange={onOtherCity} placeholder="Type the city name" /></Field>
      )}
      <Field label="Pincode"><input className={inputCls} value={f.pincode} onChange={u('pincode')} /></Field>
      <PrimaryBtn disabled={!f.name || !f.state || !f.city} onClick={submit}>
        <span className="material-symbols-outlined text-base">add_business</span> Create
      </PrimaryBtn>
    </Modal>
  );
};

export default SellerWarehouses;
