import React, { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { getUsers, createUser, updateUser, deleteUser, getWarehouses } from '../../lib/imsApi';
import { ROLE_OPTIONS as ROLES, roleLabel } from '../../lib/roles';
import { Modal, Field, inputCls, PrimaryBtn, GhostBtn, Th } from './ims/ImsUi';
import Can from '../../Components/ims/Can';
import BackButton from '../../Components/BackButton';

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) =>
  toast('error', err?.response?.data?.message || err.message || 'Something went wrong');

const STATUS_STYLES = {
  active: 'bg-green-50 text-green-600',
  invited: 'bg-amber-50 text-amber-600',
  disabled: 'bg-stone-100 text-stone-400',
};

/** Users & Roles — manage the company's IMS team. */
const CompanyUsers = () => {
  const [users, setUsers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const refresh = () =>
    getUsers().then((r) => r?.success && setUsers(r.data)).catch(apiError).finally(() => setLoading(false));
  useEffect(() => {
    refresh();
    getWarehouses().then((r) => setWarehouses(Array.isArray(r) ? r : r?.data || [])).catch(() => {});
  }, []);

  const changeRole = async (id, role) => {
    try { await updateUser(id, { role }); toast('success', 'Role updated'); refresh(); }
    catch (err) { apiError(err); }
  };
  // Warehouse-level access: assign an operations manager to a warehouse.
  // Stored as an array so a warehouse can have many users (and a user can
  // later cover several warehouses) without a schema change.
  const changeWarehouse = async (id, warehouseId) => {
    try {
      await updateUser(id, { warehouseIds: warehouseId ? [warehouseId] : [] });
      toast('success', warehouseId ? 'Warehouse assigned' : 'Assignment cleared');
      refresh();
    } catch (err) { apiError(err); }
  };
  const toggleStatus = async (u) => {
    try { await updateUser(u._id, { status: u.status === 'disabled' ? 'active' : 'disabled' }); refresh(); }
    catch (err) { apiError(err); }
  };
  const remove = async (id) => {
    const ok = await Swal.fire({ icon: 'warning', title: 'Remove this member?', showCancelButton: true, confirmButtonColor: '#EA2831' });
    if (!ok.isConfirmed) return;
    try { await deleteUser(id); toast('success', 'Removed'); refresh(); } catch (err) { apiError(err); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-5xl mx-auto space-y-6">
        <BackButton />
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-stone-900">Team & Roles</h2>
            <p className="text-xs text-stone-400">{users.length} member(s)</p>
          </div>
          <Can capability="user:create">
            <PrimaryBtn onClick={() => setShowAdd(true)}>
              <span className="material-symbols-outlined text-base">person_add</span> Add Member
            </PrimaryBtn>
          </Can>
        </div>

        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[760px] resp-table">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200">
                  <Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Warehouse</Th><Th>Status</Th><Th right>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {users.map((u) => (
                  <tr key={u._id} className="hover:bg-stone-50/30">
                    <td data-label="Name" className="px-6 py-4 text-sm font-bold text-stone-900">{u.name}</td>
                    <td data-label="Email" className="px-6 py-4 text-sm text-stone-500">{u.email || '—'}</td>
                    <td data-label="Role" className="px-6 py-4">
                      <Can
                        capability="user:update"
                        fallback={<span className="text-sm font-medium text-stone-700">{roleLabel(u.role)}</span>}
                      >
                        <select
                          value={u.role}
                          onChange={(e) => changeRole(u._id, e.target.value)}
                          className="border border-stone-200 rounded-lg text-xs px-2 py-1.5 bg-white font-medium"
                        >
                          {/* keep a legacy/unknown role visible until it's reassigned */}
                          {!ROLES.some((r) => r.value === u.role) && (
                            <option value={u.role}>{roleLabel(u.role)}</option>
                          )}
                          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </Can>
                    </td>
                    <td data-label="Warehouse" className="px-6 py-4">
                      {/* Warehouse assignment — drives warehouse-level access.
                          Admin roles are never scoped, so no selector. */}
                      {['company_admin', 'super_admin', 'auditor'].includes(u.role) ? (
                        <span className="text-xs text-stone-400">All warehouses</span>
                      ) : (
                        <Can
                          capability="user:update"
                          fallback={<span className="text-xs text-stone-500">{u.warehouseIds?.[0]?.name || 'All (unassigned)'}</span>}
                        >
                          <select
                            value={u.warehouseIds?.[0]?._id || u.warehouseIds?.[0] || ''}
                            onChange={(e) => changeWarehouse(u._id, e.target.value)}
                            className="border border-stone-200 rounded-lg text-xs px-2 py-1.5 bg-white font-medium"
                          >
                            <option value="">All (unassigned)</option>
                            {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
                          </select>
                        </Can>
                      )}
                    </td>
                    <td data-label="Status" className="px-6 py-4">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_STYLES[u.status]}`}>{u.status}</span>
                    </td>
                    <td className="px-6 py-4 cell-actions">
                      <div className="flex items-center justify-end gap-2">
                        <Can capability="user:update">
                          <GhostBtn onClick={() => toggleStatus(u)}>{u.status === 'disabled' ? 'Enable' : 'Disable'}</GhostBtn>
                        </Can>
                        <Can capability="user:delete">
                          <GhostBtn onClick={() => remove(u._id)}>Remove</GhostBtn>
                        </Can>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && users.length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-stone-400">No team members yet — add your first.</td></tr>
                )}
                {loading && <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-stone-400">Loading…</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showAdd && (
        <AddUserModal onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); refresh(); }} />
      )}
    </div>
  );
};

const AddUserModal = ({ onClose, onDone }) => {
  const [f, setF] = useState({ name: '', email: '', phone: '', role: 'operations_manager', password: '', warehouseId: '' });
  const [warehouses, setWarehouses] = useState([]);
  useEffect(() => {
    getWarehouses().then((r) => setWarehouses(Array.isArray(r) ? r : r?.data || [])).catch(() => {});
  }, []);
  const u = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    try {
      // Drop empty optional fields so backend validation doesn't reject "".
      const { warehouseId, ...rest } = f;
      const payload = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== ''));
      if (warehouseId) payload.warehouseIds = [warehouseId];
      await createUser(payload);
      toast('success', 'Team member added');
      onDone();
    } catch (err) { apiError(err); }
  };
  return (
    <Modal title="Add Team Member" onClose={onClose}>
      <Field label="Name *"><input className={inputCls} value={f.name} onChange={u('name')} /></Field>
      <Field label="Email"><input className={inputCls} value={f.email} onChange={u('email')} /></Field>
      <Field label="Phone"><input className={inputCls} value={f.phone} onChange={u('phone')} placeholder="For driver / mobile login" /></Field>
      <Field label="Role">
        <select className={inputCls} value={f.role} onChange={u('role')}>
          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </Field>
      {f.role === 'operations_manager' && (
        <Field label="Assigned Warehouse">
          <select className={inputCls} value={f.warehouseId} onChange={u('warehouseId')}>
            <option value="">All warehouses (unassigned)</option>
            {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Temp Password (optional)">
        <input className={inputCls} value={f.password} onChange={u('password')} placeholder="Leave blank to invite" />
      </Field>
      <PrimaryBtn disabled={!f.name} onClick={submit}>
        <span className="material-symbols-outlined text-base">person_add</span> Add Member
      </PrimaryBtn>
    </Modal>
  );
};

export default CompanyUsers;
