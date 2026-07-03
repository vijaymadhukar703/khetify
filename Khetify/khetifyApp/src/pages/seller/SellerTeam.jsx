import React, { useCallback, useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { Modal, Field, inputCls, PrimaryBtn } from '../Company/ims/ImsUi';
import BackButton from '../../Components/BackButton';
import {
  getSellerTeam, createSellerMember, updateSellerMember, deleteSellerMember,
  getSellerWarehouses, SELLER_TEAM_ROLES,
} from '../../lib/sellerApi';
import { useSellerPermission } from '../../context/SellerPermissionContext';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiErr = (e) => toast('error', e?.response?.data?.message || e.message || 'Something went wrong');
const ROLE_LABEL = Object.fromEntries(SELLER_TEAM_ROLES.map((r) => [r.value, r.label]));
const STATUS_STYLE = { active: 'bg-green-50 text-green-700', invited: 'bg-amber-50 text-amber-700', disabled: 'bg-stone-100 text-stone-500' };

const SellerTeam = () => {
  const canManage = useSellerPermission('user:manage');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState([]);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(() => {
    getSellerTeam().then((r) => setRows(r?.data || [])).catch(apiErr).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); getSellerWarehouses().then((r) => setWarehouses(r?.data || [])).catch(() => {}); }, [load]);

  const act = async (fn, msg) => { try { await fn(); toast('success', msg); load(); } catch (e) { apiErr(e); } };
  const changeRole = async (m) => {
    const { value, isConfirmed } = await Swal.fire({
      title: `Role for ${m.name}`, input: 'select',
      inputOptions: Object.fromEntries(SELLER_TEAM_ROLES.map((r) => [r.value, r.label])),
      inputValue: m.role, showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'Save',
    });
    if (isConfirmed && value && value !== m.role) act(() => updateSellerMember(m._id, { role: value }), 'Role updated');
  };
  const toggleStatus = (m) => act(() => updateSellerMember(m._id, { status: m.status === 'disabled' ? 'active' : 'disabled' }), 'Updated');
  const remove = async (m) => {
    const { isConfirmed } = await Swal.fire({ title: `Remove ${m.name}?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'Remove' });
    if (isConfirmed) act(() => deleteSellerMember(m._id), 'Removed');
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50/50 font-sora">
      <div className="max-w-5xl mx-auto space-y-5">
        <BackButton to="/seller/admin" />
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-stone-900">Team &amp; Roles</h1>
            <p className="text-sm text-stone-500">Invite team members and control what they can do across your seller portal.</p>
          </div>
          {canManage && <PrimaryBtn onClick={() => setShowAdd(true)}><span className="material-symbols-outlined text-base">person_add</span> Invite member</PrimaryBtn>}
        </div>

        <div className="bg-white border border-stone-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[640px] resp-table">
            <thead>
              <tr className="bg-stone-50/50 border-b border-stone-200">
                {['Name', 'Contact', 'Role', 'Status', 'Warehouses', ''].map((h, i) => (
                  <th key={i} className="px-5 py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? <tr><td colSpan={6} className="px-5 py-10 text-center text-stone-400">Loading…</td></tr>
                : rows.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-stone-400">No team members yet.</td></tr>
                : rows.map((m) => (
                  <tr key={m._id} className="hover:bg-stone-50/40">
                    <td data-label="Name" className="px-5 py-3 text-sm font-bold text-stone-800">{m.name}</td>
                    <td data-label="Contact" className="px-5 py-3 text-sm text-stone-600">{m.email || m.phone || '—'}</td>
                    <td data-label="Role" className="px-5 py-3"><span className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-stone-100 text-stone-600">{ROLE_LABEL[m.role] || m.role}</span></td>
                    <td data-label="Status" className="px-5 py-3"><span className={`text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${STATUS_STYLE[m.status] || 'bg-stone-100 text-stone-500'}`}>{m.status}</span></td>
                    <td data-label="Warehouses" className="px-5 py-3 text-[11px] text-stone-500">{(m.warehouseIds || []).map((w) => w.name).join(', ') || 'All'}</td>
                    <td className="px-5 py-3 cell-actions text-right">
                      {canManage && (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => changeRole(m)} className="text-xs font-bold text-stone-500 hover:text-[#EA2831]">Role</button>
                          <button onClick={() => toggleStatus(m)} className="text-xs font-bold text-stone-500 hover:text-[#EA2831]">{m.status === 'disabled' ? 'Enable' : 'Disable'}</button>
                          <button onClick={() => remove(m)} className="text-xs font-bold text-stone-400 hover:text-red-500">Remove</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <AddMemberModal warehouses={warehouses} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); load(); }} />}
    </div>
  );
};

const AddMemberModal = ({ warehouses, onClose, onDone }) => {
  const [f, setF] = useState({ name: '', email: '', phone: '', role: 'seller_staff', password: '' });
  const [whs, setWhs] = useState([]);
  const [busy, setBusy] = useState(false);
  const u = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggleWh = (id) => setWhs((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async () => {
    if (!f.name || !f.password || (!f.email && !f.phone)) { toast('error', 'Name, a contact (email/phone) and a password are required'); return; }
    setBusy(true);
    try {
      await createSellerMember({ ...f, warehouseIds: whs });
      toast('success', 'Team member added');
      onDone();
    } catch (e) { apiErr(e); } finally { setBusy(false); }
  };

  return (
    <Modal title="Invite team member" onClose={onClose}>
      <Field label="Name *"><input className={inputCls} value={f.name} onChange={u('name')} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Email"><input className={inputCls} value={f.email} onChange={u('email')} /></Field>
        <Field label="Phone"><input className={inputCls} value={f.phone} onChange={u('phone')} /></Field>
      </div>
      <Field label="Role *">
        <select className={inputCls} value={f.role} onChange={u('role')}>
          {SELLER_TEAM_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </Field>
      <Field label="Temporary password *"><input className={inputCls} type="text" value={f.password} onChange={u('password')} placeholder="They sign in with this" /></Field>
      {warehouses.length > 0 && (
        <div className="mb-3">
          <label className="block text-xs font-bold text-stone-600 mb-1">Warehouses (optional — empty = all)</label>
          <div className="flex flex-wrap gap-2">
            {warehouses.map((w) => (
              <button key={w._id} type="button" onClick={() => toggleWh(w._id)} className={`text-xs px-2.5 py-1 rounded-lg border ${whs.includes(w._id) ? 'border-[#EA2831] bg-red-50 text-[#EA2831]' : 'border-stone-200 text-stone-600'}`}>{w.name}</button>
            ))}
          </div>
        </div>
      )}
      <PrimaryBtn disabled={busy} onClick={submit}>{busy ? 'Adding…' : 'Add member'}</PrimaryBtn>
    </Modal>
  );
};

export default SellerTeam;
