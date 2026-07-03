import React, { useEffect, useMemo, useState } from 'react';
import Swal from 'sweetalert2';
import { getWarehouses, createWarehouse, updateWarehouse, getLots, fmtDate } from '../../../lib/imsApi';
import { Modal, Field, inputCls, PrimaryBtn } from './ImsUi';
import { usePermission } from '../../../context/PermissionContext';
import { State, City } from 'country-state-city';

const OTHER_CITY = '__other__';

/**
 * Occupancy figures from live units vs capacity.
 *  - pct       : the TRUE percentage — never clamped, so an overfilled
 *                warehouse reads e.g. 202.5% instead of a misleading 100%.
 *  - pctLabel  : pct formatted (integer when whole, else 1 decimal).
 *  - barWidth  : clamped to 100 — the visual track can't exceed its width.
 *  - over      : units stored above capacity (0 when within).
 * Returns null when the warehouse has no capacity set (uncapped).
 */
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

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });

/** Warehouses — occupancy per warehouse, computed from live lot rows. */
const ImsWarehouses = () => {
  // Warehouses are company infrastructure: only the admin can add them
  // (warehouse:manage resolves only via the company_admin wildcard).
  const canManageWarehouses = usePermission('warehouse:manage');
  const [warehouses, setWarehouses] = useState([]);
  const [lots, setLots] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null); // warehouse being edited
  const [detail, setDetail] = useState(null); // { warehouse, occ } when a card is opened

  const refresh = () => {
    getWarehouses().then((r) => r?.success && setWarehouses(r.data)).catch(() => {});
    getLots().then((r) => r?.success && setLots(r.data)).catch(() => {});
  };
  useEffect(refresh, []);

  const byWarehouse = useMemo(() => {
    const map = {};
    for (const l of lots) {
      const id = l.warehouseId?._id || 'none';
      if (!map[id]) map[id] = { units: 0, lots: [] };
      if (l.availableStock > 0) {
        map[id].units += l.availableStock;
        map[id].lots.push(l);
      }
    }
    return map;
  }, [lots]);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
            {warehouses.length} warehouse(s) · occupancy computed from live lots
          </p>
          {canManageWarehouses && (
            <PrimaryBtn onClick={() => setShowCreate(true)}>
              <span className="material-symbols-outlined text-base">add_business</span> Add Warehouse
            </PrimaryBtn>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {warehouses.map((w) => {
            const occ = byWarehouse[w._id] || { units: 0, lots: [] };
            const info = occupancyInfo(occ.units, w.capacityUnits);
            return (
              <div key={w._id} role="button" tabIndex={0}
                onClick={() => setDetail({ warehouse: w, occ })}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail({ warehouse: w, occ }); } }}
                className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm cursor-pointer hover:shadow-md hover:border-[#EA2831]/40 transition-all">
                <div className="flex items-start justify-between mb-1">
                  <h3 className="font-bold text-stone-900">{w.name}</h3>
                  <div className="flex items-center gap-1">
                    {canManageWarehouses && (
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
                <p className="text-xs text-stone-400 mb-4">
                  {[w.address?.city, w.address?.state].filter(Boolean).join(', ') || w.code || '—'}
                </p>
                <div className="flex justify-between text-xs font-bold mb-1.5">
                  <span className="text-stone-900">{occ.units.toLocaleString('en-IN')} units</span>
                  {info && (
                    <span className={info.over > 0 ? 'text-red-600' : info.pct > 85 ? 'text-red-600' : 'text-stone-400'}>
                      {info.pctLabel}% of {w.capacityUnits.toLocaleString('en-IN')}
                    </span>
                  )}
                </div>
                {info && (
                  <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden mb-1">
                    <div
                      className={`h-full rounded-full ${info.over > 0 || info.pct > 85 ? 'bg-red-500' : info.pct > 60 ? 'bg-orange-400' : 'bg-green-500'}`}
                      style={{ width: `${info.barWidth}%` }}
                    />
                  </div>
                )}
                {info && info.over > 0 && (
                  <p className="text-[10px] font-bold text-red-600 mb-4">
                    Over capacity by {info.over.toLocaleString('en-IN')} units
                  </p>
                )}
                {info && info.over === 0 && <div className="mb-4" />}
                <div className="space-y-1.5">
                  {occ.lots.slice(0, 4).map((l) => (
                    <div key={l._id} className="flex justify-between text-xs border-b border-dashed border-stone-100 pb-1.5">
                      <span className="text-stone-500 truncate pr-2">
                        {l.productId?.productName} · <b>{l.lotNumber || l.batchNumber}</b>
                      </span>
                      <span className="font-bold text-stone-900">{l.availableStock}</span>
                    </div>
                  ))}
                  {occ.lots.length === 0 && <p className="text-xs text-stone-300">Empty</p>}
                  {occ.lots.length > 4 && <p className="text-[10px] text-stone-400">+{occ.lots.length - 4} more lots</p>}
                </div>
              </div>
            );
          })}
          {warehouses.length === 0 && (
            <p className="text-sm text-stone-400 col-span-full py-10 text-center">
              No warehouses yet — add your first one.
            </p>
          )}
        </div>
      </div>

      {detail && (
        <WarehouseDetailModal
          warehouse={detail.warehouse}
          occ={detail.occ}
          onClose={() => setDetail(null)}
        />
      )}

      {showCreate && (
        <WarehouseFormModal
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); refresh(); }}
        />
      )}

      {editing && (
        <WarehouseFormModal
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

/** Read-only warehouse detail: profile + occupancy + the full lot list. */
const WarehouseDetailModal = ({ warehouse: w, occ, onClose }) => {
  const info = occupancyInfo(occ.units, w.capacityUnits);
  const addr = [w.address?.line1, w.address?.city, w.address?.district, w.address?.state, w.address?.pincode]
    .filter(Boolean).join(', ');
  return (
    <Modal title={w.name} onClose={onClose} wide>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Meta label="Code" value={w.code || '—'} />
        <Meta label="Location" value={addr || '—'} />
        <Meta label="Capacity" value={w.capacityUnits ? `${w.capacityUnits.toLocaleString('en-IN')} units` : '—'} />
        <Meta label="In stock" value={`${occ.units.toLocaleString('en-IN')} units`} />
      </div>

      {info && (
        <div className="mb-5">
          <div className="flex justify-between text-xs font-bold mb-1.5">
            <span className="text-stone-500">Occupancy</span>
            <span className={info.over > 0 || info.pct > 85 ? 'text-red-600' : 'text-stone-400'}>{info.pctLabel}% of {w.capacityUnits.toLocaleString('en-IN')}</span>
          </div>
          <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${info.over > 0 || info.pct > 85 ? 'bg-red-500' : info.pct > 60 ? 'bg-orange-400' : 'bg-green-500'}`}
              style={{ width: `${info.barWidth}%` }}
            />
          </div>
          {info.over > 0 && (
            <p className="text-xs font-bold text-red-600 mt-1.5">
              Over capacity by {info.over.toLocaleString('en-IN')} units
            </p>
          )}
        </div>
      )}

      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">
        Lots in this warehouse ({occ.lots.length})
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
              {occ.lots.map((l) => (
                <tr key={l._id}>
                  <td data-label="Product" className="px-4 py-2 text-stone-700">{l.productId?.productName || '—'}</td>
                  <td data-label="Lot No." className="px-4 py-2 font-mono text-xs font-bold text-stone-900">{l.lotNumber || l.batchNumber || '—'}</td>
                  <td data-label="Expiry" className="px-4 py-2 text-xs text-stone-500">{l.expiryDate ? fmtDate(l.expiryDate) : '—'}</td>
                  <td data-label="Qty" className="px-4 py-2 text-right font-bold text-stone-900">{(l.availableStock ?? 0).toLocaleString('en-IN')}</td>
                </tr>
              ))}
              {occ.lots.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-stone-400">No stock in this warehouse.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
};

const WarehouseFormModal = ({ warehouse, onClose, onDone }) => {
  const isEdit = !!warehouse;

  // Dependent State → City dropdowns (data ships with country-state-city, no API).
  // We STORE the full names (f.state / f.city); stateIso only drives the city list.
  const states = useMemo(() => State.getStatesOfCountry('IN'), []);

  // In edit mode, resolve the stored state NAME back to its isoCode so the
  // dependent city list works, and decide whether the city is a listed one.
  const initialStateIso = useMemo(
    () => (warehouse?.address?.state ? states.find((s) => s.name === warehouse.address.state)?.isoCode || '' : ''),
    [warehouse, states],
  );
  const initialCityChoice = useMemo(() => {
    const c = warehouse?.address?.city;
    if (!c) return '';
    const list = initialStateIso ? City.getCitiesOfState('IN', initialStateIso) : [];
    return list.some((x) => x.name === c) ? c : OTHER_CITY;
  }, [warehouse, initialStateIso]);

  const [f, setF] = useState({
    name: warehouse?.name || '',
    code: warehouse?.code || '',
    city: warehouse?.address?.city || '',
    state: warehouse?.address?.state || '',
    pincode: warehouse?.address?.pincode || '',
    capacityUnits: warehouse?.capacityUnits ?? '',
  });
  const u = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const [stateIso, setStateIso] = useState(initialStateIso);
  const cities = useMemo(() => (stateIso ? City.getCitiesOfState('IN', stateIso) : []), [stateIso]);
  const [cityChoice, setCityChoice] = useState(initialCityChoice); // a listed city name or OTHER_CITY
  const [otherCity, setOtherCity] = useState(initialCityChoice === OTHER_CITY ? (warehouse?.address?.city || '') : '');

  const onStateChange = (e) => {
    const iso = e.target.value;
    const name = states.find((s) => s.isoCode === iso)?.name || '';
    setStateIso(iso);
    // Picking a new state always resets the city.
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
    // Edit keeps '' so the server can clear capacity; create omits it (undefined).
    const capacity = f.capacityUnits === '' ? (isEdit ? '' : undefined) : Number(f.capacityUnits);
    const payload = {
      name: f.name,
      code: f.code,
      address: { city: f.city, state: f.state, pincode: f.pincode },
      capacityUnits: capacity,
    };
    try {
      if (isEdit) {
        await updateWarehouse(warehouse._id, payload);
        toast('success', 'Warehouse updated');
      } else {
        await createWarehouse(payload);
        toast('success', 'Warehouse created');
      }
      onDone();
    } catch (err) {
      // 403 on create usually means the plan lacks multi_warehouse — server enforces it
      toast('error', err?.response?.data?.message || `Could not ${isEdit ? 'update' : 'create'} warehouse`);
    }
  };
  return (
    <Modal title={isEdit ? 'Edit Warehouse' : 'Add Warehouse'} onClose={onClose}>
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
        <span className="material-symbols-outlined text-base">{isEdit ? 'save' : 'add_business'}</span> {isEdit ? 'Save Changes' : 'Create'}
      </PrimaryBtn>
    </Modal>
  );
};

export default ImsWarehouses;
