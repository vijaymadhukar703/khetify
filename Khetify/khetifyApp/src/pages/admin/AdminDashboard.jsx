import React, { useCallback, useEffect, useState } from 'react';
import { getAdminDashboard } from '../../lib/adminApi';

// One stat card — colored top accent per the spec (pending amber, approved
// green, rejected red; total neutral).
const StatCard = ({ icon, label, value, accent, loading }) => (
  <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
    <div className={`h-1 ${accent}`} />
    <div className="flex items-center gap-4 p-5">
      <div className="h-12 w-12 rounded-xl bg-stone-50 border border-stone-100 flex items-center justify-center text-stone-500 shrink-0">
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
        <p className="text-3xl font-bold text-stone-900 leading-tight">
          {loading ? <span className="inline-block h-7 w-10 bg-stone-100 rounded animate-pulse align-middle" /> : value}
        </p>
      </div>
    </div>
  </div>
);

const AdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getAdminDashboard();
      setStats(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const s = stats || {};
  const cards = [
    { key: 'totalCompanies', icon: 'apartment', label: 'Total Companies', accent: 'bg-stone-300' },
    { key: 'pendingCompanies', icon: 'hourglass_empty', label: 'Pending', accent: 'bg-amber-400' },
    { key: 'approvedCompanies', icon: 'verified', label: 'Approved', accent: 'bg-green-500' },
    { key: 'rejectedCompanies', icon: 'block', label: 'Rejected', accent: 'bg-red-500' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8">
      <div className="flex items-start justify-between gap-4 mb-7">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Dashboard</h1>
          <p className="text-stone-500">Marketplace health at a glance — companies awaiting review.</p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 border border-stone-200 hover:bg-stone-50 text-stone-700 text-sm font-bold rounded-lg px-3.5 py-2 transition-colors shrink-0"
        >
          <span className="material-symbols-outlined text-[18px]">refresh</span> Refresh
        </button>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm mb-6">{error}</div>
      ) : null}

      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-3">Companies</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {cards.map((c) => (
          <StatCard key={c.key} icon={c.icon} label={c.label} accent={c.accent} value={s[c.key] ?? 0} loading={loading} />
        ))}
      </div>
    </div>
  );
};

export default AdminDashboard;
