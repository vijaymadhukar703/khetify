import React, { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { driverLogin, driverShipments, driverArrived, driverPod, driverException, fmtDate } from '../../lib/imsApi';
import { movementKind } from '../../lib/movementLabel';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Error');
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);

const getPos = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve({});
  navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve({}), { timeout: 5000 });
});

const STATUS = { planned: 'bg-blue-100 text-blue-700', in_transit: 'bg-orange-100 text-orange-700', arrived: 'bg-amber-100 text-amber-700', delivered: 'bg-green-100 text-green-700', exception: 'bg-red-100 text-red-700' };

/** Minimal mobile web app for drivers (login by phone + PIN). Route: /driver */
const DriverApp = () => {
  const [authed, setAuthed] = useState(!!localStorage.getItem('driverToken'));
  const [driver, setDriver] = useState(JSON.parse(localStorage.getItem('driver') || 'null'));

  if (!authed) return <Login onDone={(d) => { setDriver(d); setAuthed(true); }} />;
  return <Shipments driver={driver} onLogout={() => { localStorage.clear(); setAuthed(false); }} />;
};

const Login = ({ onDone }) => {
  const [f, setF] = useState({ phone: '', pin: '' });
  const submit = async () => {
    try {
      const r = await driverLogin(f);
      // store as the active token so the API layer authenticates the driver
      localStorage.setItem('token', r.token);
      localStorage.setItem('driverToken', r.token);
      localStorage.setItem('driver', JSON.stringify(r.driver));
      onDone(r.driver);
    } catch (err) { apiError(err); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 p-4 font-sora">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow p-6 space-y-4">
        <h1 className="text-xl font-bold text-[#EA2831] text-center">Khetify Driver</h1>
        <input className="w-full border border-stone-200 rounded-xl px-4 py-3" placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <input className="w-full border border-stone-200 rounded-xl px-4 py-3" placeholder="PIN" type="password" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} />
        <button onClick={submit} className="w-full bg-[#EA2831] text-white rounded-xl py-3 font-bold">Log in</button>
      </div>
    </div>
  );
};

const Shipments = ({ driver, onLogout }) => {
  const [rows, setRows] = useState([]);
  const refresh = () => driverShipments().then((r) => setRows(listOf(r))).catch(apiError);
  useEffect(() => { refresh(); }, []);

  const arrived = async (s) => { try { await driverArrived(s._id, await getPos()); toast('success', 'Marked arrived'); refresh(); } catch (e) { apiError(e); } };
  const deliver = async (s) => {
    const { value: signedBy } = await Swal.fire({ title: 'Proof of delivery', input: 'text', inputLabel: 'Received by (name)', showCancelButton: true });
    if (!signedBy) return;
    try { await driverPod(s._id, { signedBy, ...(await getPos()) }); toast('success', 'Delivered'); refresh(); } catch (e) { apiError(e); }
  };
  const exception = async (s) => {
    const { value: note } = await Swal.fire({ title: 'Report problem', input: 'text', inputPlaceholder: 'What happened?', showCancelButton: true });
    if (!note) return;
    try { await driverException(s._id, { note, ...(await getPos()) }); toast('success', 'Reported'); refresh(); } catch (e) { apiError(e); }
  };

  return (
    <div className="min-h-screen bg-stone-50 font-sora">
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex justify-between items-center sticky top-0">
        <div><p className="font-bold text-stone-900">{driver?.name}</p><p className="text-xs text-stone-400">My deliveries</p></div>
        <button onClick={onLogout} className="text-xs text-stone-400">Log out</button>
      </div>
      <div className="p-4 space-y-3">
        {rows.map((s) => (
          <div key={s._id} className="bg-white rounded-2xl shadow-sm p-4">
            <div className="flex justify-between items-start">
              <div><p className="font-bold text-stone-900">{s.toLabel}</p><p className="text-xs text-stone-400">{movementKind(s)} · {s.dispatchedAt ? fmtDate(s.dispatchedAt) : 'not dispatched'}</p></div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS[s.status] || 'bg-stone-100'}`}>{s.status}</span>
            </div>
            <div className="flex gap-2 mt-3">
              {['in_transit'].includes(s.status) && <button onClick={() => arrived(s)} className="flex-1 bg-amber-500 text-white rounded-xl py-2.5 text-sm font-bold">Arrived</button>}
              {['in_transit', 'arrived'].includes(s.status) && s.toType === 'customer' && <button onClick={() => deliver(s)} className="flex-1 bg-green-600 text-white rounded-xl py-2.5 text-sm font-bold">Deliver</button>}
              <button onClick={() => exception(s)} className="px-4 bg-stone-100 text-stone-600 rounded-xl py-2.5 text-sm font-bold">Issue</button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-center text-stone-400 text-sm py-10">No assigned shipments.</p>}
      </div>
    </div>
  );
};

export default DriverApp;
