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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate the Invite Team Member form. Trims first (whitespace-only = empty),
 *  matching the mandatory-field rule the seller API enforces server-side
 *  (validators/userValidators.js → createSellerMemberBody). */
const validateMember = (f, { warehouseRequired }) => {
  const v = { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), password: f.password.trim() };
  const e = {};
  if (!v.name) e.name = 'Name is required';
  if (!v.email) e.email = 'Email is required';
  else if (!EMAIL_RE.test(v.email)) e.email = 'Enter a valid email';
  if (!v.phone) e.phone = 'Phone is required';
  else if (!/^\d{10}$/.test(v.phone)) e.phone = 'Enter a valid 10-digit phone number';
  if (!f.role) e.role = 'Role is required';
  if (!v.password) e.password = 'Temporary Password is required';
  else if (v.password.length < 6) e.password = 'Temporary Password must be at least 6 characters';
  if (warehouseRequired && !f.whs.length) e.warehouse = 'Assigned Warehouse is required';
  return e;
};

const FieldError = ({ msg }) => (msg ? <p className="text-xs font-medium text-[#EA2831] mt-1">⚠ {msg}</p> : null);
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
  // Role + warehouse start empty so the operator must actively pick both.
  const [f, setF] = useState({ name: '', email: '', phone: '', role: '', password: '' });
  const [whs, setWhs] = useState([]);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const u = (k) => (e) => { setF({ ...f, [k]: e.target.value }); if (errors[k]) setErrors((p) => ({ ...p, [k]: undefined })); };

  const warehouseRequired = warehouses.length > 0;
  // Every visible field is mandatory — button stays disabled until each is
  // non-empty; format errors surface on submit.
  const canSubmit = !busy && !!(f.name.trim() && f.email.trim() && f.phone.trim() && f.role && f.password.trim()
    && (!warehouseRequired || whs.length));

  const submit = async () => {
    const e = validateMember({ ...f, whs }, { warehouseRequired });
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      // Send trimmed values; all fields are required now.
      await createSellerMember({
        name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(),
        role: f.role, password: f.password.trim(), warehouseIds: whs,
      });
      toast('success', 'Team member added');
      onDone();
    } catch (e2) { apiErr(e2); } finally { setBusy(false); }
  };

  // UI mirrors the Company "Add Team Member" modal (pages/Company/CompanyUsers.jsx):
  // the same shared Modal/Field/inputCls/PrimaryBtn, one full-width field per row,
  // stacked vertically. Seller wording, roles, warehouse multi-select, validation
  // and the invite/password logic are unchanged.
  return (
    <Modal title="Invite team member" onClose={onClose}>
      <Field label="Name *"><input className={inputCls} value={f.name} onChange={u('name')} /><FieldError msg={errors.name} /></Field>
      <Field label="Email *"><input className={inputCls} value={f.email} onChange={u('email')} /><FieldError msg={errors.email} /></Field>
      <Field label="Phone *">
        <input className={inputCls} type="tel" inputMode="numeric" maxLength={10} value={f.phone}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
            setF({ ...f, phone: digits });
            if (errors.phone) setErrors((p) => ({ ...p, phone: undefined }));
          }} />
        <FieldError msg={errors.phone} />
      </Field>
      {/* Dropdown stays ENABLED — Operations Manager is simply the only role a
          new member can be given. (An existing member's role can still be
          changed from the table.)
          NB: the VALUE is the seller's own operations role `seller_manager` —
          the company-side `operations_manager` is not a seller role and the API
          rejects it (SELLER_ASSIGNABLE_ROLES). seller_manager is its exact
          equivalent: operate warehouses/inventory/transfers, no team/billing. */}
      <Field label="Role *">
        <select className={inputCls} value={f.role} onChange={u('role')} required>
          <option value="" disabled>Select role</option>
          <option value="seller_manager">Operations Manager</option>
        </select>
        <FieldError msg={errors.role} />
      </Field>
      {warehouses.length > 0 && (
        // Same dropdown as the Company form's "Assigned Warehouse". Still stored
        // as the warehouseIds ARRAY the API expects, so the payload shape is
        // unchanged. "All warehouses (unassigned)" is no longer selectable — a
        // warehouse must be chosen, so the blank option is a disabled placeholder.
        <Field label="Assigned Warehouse *">
          <select
            className={inputCls}
            value={whs[0] || ''}
            onChange={(e) => { setWhs(e.target.value ? [e.target.value] : []); if (errors.warehouse) setErrors((p) => ({ ...p, warehouse: undefined })); }}
            required
          >
            <option value="" disabled>Select warehouse</option>
            {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
          </select>
          <FieldError msg={errors.warehouse} />
        </Field>
      )}
      <Field label="Temporary Password *">
        <input className={inputCls} type="text" value={f.password} onChange={u('password')} placeholder="They sign in with this" />
        <FieldError msg={errors.password} />
      </Field>
      <PrimaryBtn disabled={!canSubmit} onClick={submit}>
        <span className="material-symbols-outlined text-base">person_add</span> {busy ? 'Adding…' : 'Add Member'}
      </PrimaryBtn>
    </Modal>
  );
};

export default SellerTeam;
