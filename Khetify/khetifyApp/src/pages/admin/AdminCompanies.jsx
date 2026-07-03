import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAdminCompanies } from '../../lib/adminApi';
import { StatusBadge, fmtDate } from '../../Components/admin/AdminUi';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const AdminCompanies = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'all';

  const [searchInput, setSearchInput] = useState(params.get('search') || '');
  const [search, setSearch] = useState(params.get('search') || '');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Server-side filter: status tab + case-insensitive search across
      // name/email/GSTIN/PAN. Empty search is omitted so all rows come back.
      const res = await getAdminCompanies({ status, search: search || undefined });
      setRows(res.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load companies');
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => { load(); }, [load]);

  // Commit a search term: sync the URL (?search=) + trigger the query. Shared by
  // the debounced typing effect AND the explicit Enter/Search-button submit.
  const commitSearch = useCallback((raw) => {
    const v = (raw || '').trim();
    setSearch(v);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v) next.set('search', v); else next.delete('search');
      return next;
    }, { replace: true });
  }, [setParams]);

  // Live search: debounce typing so results filter as you type (clearing the
  // box restores all companies). Enter / the Search button still fire instantly.
  useEffect(() => {
    if (searchInput.trim() === search) return; // already in sync (e.g. after submit)
    const t = setTimeout(() => commitSearch(searchInput), 350);
    return () => clearTimeout(t);
  }, [searchInput, search, commitSearch]);

  const setStatus = (key) => {
    const next = new URLSearchParams(params);
    if (key === 'all') next.delete('status'); else next.set('status', key);
    setParams(next, { replace: true });
  };

  const submitSearch = (e) => {
    e.preventDefault();
    commitSearch(searchInput);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8">
      <h1 className="text-2xl font-bold text-stone-900">Companies</h1>
      <p className="text-stone-500 mb-6">Review and approve registered companies.</p>

      {/* Filters + search */}
      <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-4 mb-5 flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                status === t.key ? 'bg-[#EA2831] text-white' : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={submitSearch} className="flex items-center gap-2 w-full lg:w-auto">
          <div className="relative flex-1 lg:w-80">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-[20px]">search</span>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, email, GSTIN…"
              className="w-full border border-stone-200 rounded-lg pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#EA2831]/30 focus:border-[#EA2831]"
            />
          </div>
          <button type="submit" className="bg-stone-900 hover:bg-stone-800 text-white text-sm font-bold rounded-lg px-4 py-2.5 transition-colors shrink-0">
            Search
          </button>
        </form>
      </div>

      {/* Table */}
      <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
        {error ? (
          <div className="px-6 py-10 text-center text-sm text-red-600">{error}</div>
        ) : loading ? (
          <div className="px-6 py-16 text-center text-sm text-stone-400">Loading companies…</div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <span className="material-symbols-outlined text-4xl text-stone-300">apartment</span>
            <p className="mt-2 text-sm font-semibold text-stone-500">No companies found</p>
            <p className="text-xs text-stone-400">Try a different filter or search.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-stone-100">
                  {['Company', 'Contact', 'Type', 'Status', 'Submitted', ''].map((h, i) => (
                    <th key={i} className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c._id}
                    onClick={() => navigate(`/admin/companies/${c._id}`)}
                    className="border-b border-stone-50 last:border-0 hover:bg-stone-50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4 font-bold text-stone-900">{c.name}</td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-stone-700">{c.email || '—'}</div>
                      <div className="text-xs text-stone-400">{c.phone || '—'}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-stone-600">{c.businessType || '—'}</td>
                    <td className="px-6 py-4"><StatusBadge status={c.status} /></td>
                    <td className="px-6 py-4 text-sm text-stone-500">{fmtDate(c.submittedAt)}</td>
                    <td className="px-6 py-4 text-right">
                      <span className="material-symbols-outlined text-stone-300">chevron_right</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminCompanies;
