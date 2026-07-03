import React, { useEffect, useState } from 'react';
import { getDashboardSummary, formatINR } from '../../lib/imsApi';
import { usePermission } from '../../context/PermissionContext';

/**
 * The headline IMS numbers for the company dashboard. Self-contained: fetches
 * /api/reports/dashboard. Renders nothing if the call fails (e.g. no token).
 * The sales card is hidden for roles without order:read (e.g. operations_manager).
 */
const Card = ({ icon, label, value, accent }) => (
  <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm flex items-center gap-4">
    <span className={`material-symbols-outlined text-3xl ${accent}`}>{icon}</span>
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
      <p className="text-xl font-bold text-stone-900">{value}</p>
    </div>
  </div>
);

const SummaryCards = () => {
  const [d, setD] = useState(null);
  const { can, loading } = usePermission();
  const canSeeSales = !loading && can('order:read');
  useEffect(() => { getDashboardSummary().then((r) => r?.success && setD(r.data)).catch(() => {}); }, []);
  if (!d) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card icon="inventory_2" label="Stock Value" value={formatINR(d.stockValue)} accent="text-stone-400" />
      <Card icon="schedule" label="Expiring (≤90d)" value={formatINR(d.expiringValue)} accent="text-orange-400" />
      <Card icon="local_shipping" label="Open Shipments" value={d.openShipments} accent="text-blue-400" />
      {canSeeSales && (
        <Card icon="payments" label="Today's Sales" value={formatINR(d.todaySales)} accent="text-green-500" />
      )}
    </div>
  );
};

export default SummaryCards;
