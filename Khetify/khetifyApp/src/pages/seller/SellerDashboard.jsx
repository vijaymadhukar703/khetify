import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getSellerLink, getSellerDashboardSummary, getSellerSupplyOrders, getSellerTransfers,
} from '../../lib/sellerApi';
import { formatINR } from '../../lib/imsApi';
import { useSellerSubscription } from '../../context/SellerSubscriptionContext';
import { useSellerPermission } from '../../context/SellerPermissionContext';

// Supply-order status groups (mirror SellerSupply.jsx).
const PENDING = ['requested', 'under_review', 'approved', 'picking', 'packed'];
const IN_TRANSIT = ['dispatched', 'in_transit', 'arrived'];
const RECEIVED = ['received', 'partially_received', 'delivered'];

const pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0);

// Seller Dashboard — the warehouse manager's at-a-glance view. Mirrors the
// company CompanyDashboard (KPI strip + operations overview + inventory status +
// quick actions) but seller-scoped; for a seller_manager every number is
// limited to their assigned warehouse(s) by the backend (warehouseScope).
const SellerDashboard = () => {
  const navigate = useNavigate();
  const { sellerCan } = useSellerSubscription(); // owner plan features
  const { sellerCan: hasCap } = useSellerPermission();
  const canAnalytics = sellerCan('inventory_view'); // paid lot-level reports

  const [approved, setApproved] = useState(null);
  const [kpi, setKpi] = useState(null);
  const [supply, setSupply] = useState([]);
  const [transfers, setTransfers] = useState([]);

  useEffect(() => {
    let alive = true;
    getSellerLink()
      .then((r) => {
        const ok = r?.data?.linkStatus === 'approved';
        if (!alive) return;
        setApproved(ok);
        if (!ok) return;
        getSellerDashboardSummary().then((s) => { if (alive && s?.success) setKpi(s.data); }).catch(() => {});
        getSellerSupplyOrders().then((s) => { if (alive && s?.success) setSupply(s.data || []); }).catch(() => {});
        getSellerTransfers().then((t) => { if (alive && t?.success) setTransfers(t.data || []); }).catch(() => {});
      })
      .catch(() => { if (alive) setApproved(false); });
    return () => { alive = false; };
  }, []);

  const ops = useMemo(() => {
    const pending = supply.filter((o) => PENDING.includes(o.status)).length;
    const inTransit = supply.filter((o) => IN_TRANSIT.includes(o.status)).length;
    const received = supply.filter((o) => RECEIVED.includes(o.status)).length;
    return { pending, inTransit, received, total: supply.length, recent: supply.slice(0, 5) };
  }, [supply]);

  const openShipments = ops.pending + ops.inTransit;
  const health = useMemo(() => {
    const total = kpi?.totalLots || 0;
    const low = kpi?.lowStock || 0;
    const out = kpi?.outOfStock || 0;
    const healthy = Math.max(0, (kpi?.lots || 0) - low);
    return { total, healthy, low, out, healthyPct: pct(healthy, total), lowPct: pct(low, total), outPct: pct(out, total) };
  }, [kpi]);

  if (approved === null) return <div className="flex-1 p-8 text-center text-stone-400 font-sora">Loading…</div>;
  if (!approved) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">lock</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Dashboard is locked</h2>
          <p className="text-sm text-amber-700 mt-1">Available after your supplying company approves you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-[#f8f9fa] font-sora">
      <div className="max-w-[1400px] mx-auto space-y-6 sm:space-y-8">
        {/* Headline KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <KpiCard icon="inventory_2" label="Stock value" value={kpi ? formatINR(kpi.stockValue) : '—'} />
          <KpiCard icon="schedule" label="Expiring (≤90d)" value={kpi ? formatINR(kpi.expiringValue) : '—'} accent="text-amber-600" />
          <KpiCard icon="local_shipping" label="Open shipments" value={openShipments} />
          <KpiCard icon="package_2" label="Lots in stock" value={kpi?.lots ?? '—'} />
        </div>

        {/* Secondary stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <StatCard label="Total lots" value={kpi?.totalLots ?? '—'} />
          <StatCard label="Low stock items" value={kpi?.lowStock ?? '—'} accent="text-[#EA2831]" />
          <StatCard label="Out of stock" value={kpi?.outOfStock ?? '—'} accent="text-[#EA2831]" />
          <StatCard label="Pending supply" value={ops.pending} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
          {/* Operations overview */}
          <div className="lg:col-span-2 bg-white border border-stone-200 rounded-xl p-5 sm:p-8">
            <h3 className="text-lg font-bold text-stone-900 mb-6">Operations overview</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8 border-b border-stone-100 pb-8">
              {[
                { label: 'Pending supply', value: ops.pending, accent: 'text-[#EA2831]' },
                { label: 'In transit', value: ops.inTransit, accent: 'text-stone-900' },
                { label: 'Transfers', value: transfers.length, accent: 'text-stone-900' },
                { label: 'Total supply orders', value: ops.total, accent: 'text-stone-900' },
              ].map((t) => (
                <div key={t.label}>
                  <p className="text-xs text-stone-500 mb-1 uppercase tracking-wider">{t.label}</p>
                  <p className={`text-xl sm:text-2xl font-bold ${t.accent}`}>{t.value}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">Recent supply orders</p>
            {ops.recent.length ? (
              <div className="divide-y divide-stone-50">
                {ops.recent.map((o) => (
                  <div key={o._id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-stone-700 truncate pr-3">
                      {(o.items || []).length} item(s) → {o.warehouseId?.name || 'warehouse'}
                    </span>
                    <span className="text-xs font-semibold text-stone-400 capitalize">{(o.status || '').replace(/_/g, ' ')}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-stone-400">No supply orders yet.</p>
            )}
          </div>

          {/* Right column: inventory status + quick actions */}
          <div className="flex flex-col gap-6">
            <div className="bg-white border border-stone-200 rounded-xl p-6 shadow-sm">
              <h3 className="text-lg font-bold text-stone-900 mb-6">Inventory status</h3>
              {!kpi ? (
                <p className="text-sm text-stone-400">Loading…</p>
              ) : health.total === 0 ? (
                <p className="text-sm text-stone-400 py-2">No stock yet — receive a supply order to populate your inventory.</p>
              ) : (
                <>
                  <p className="text-xs text-stone-500 mb-4">
                    <span className="font-bold text-stone-900">{health.total}</span> lots ·{' '}
                    <span className="font-bold text-stone-900">{formatINR(kpi.stockValue)}</span> stock value
                  </p>
                  <div className="flex h-3 w-full rounded-full overflow-hidden bg-stone-50 mb-8">
                    <div className="bg-stone-800 h-full" style={{ width: `${health.healthyPct}%` }} />
                    <div className="bg-[#EA2831]/60 h-full border-l border-white" style={{ width: `${health.lowPct}%` }} />
                    <div className="bg-[#EA2831] h-full border-l border-white" style={{ width: `${health.outPct}%` }} />
                  </div>
                  <div className="space-y-4">
                    {[
                      { label: 'In stock', color: 'bg-stone-800', value: `${health.healthyPct}%` },
                      { label: 'Low stock', color: 'bg-[#EA2831]/60', value: `${health.lowPct}%` },
                      { label: 'Out of stock', color: 'bg-[#EA2831]', value: `${health.outPct}%` },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-3">
                          <span className={`size-2.5 rounded-full ${item.color}`} />
                          <span className="text-stone-600 font-medium">{item.label}</span>
                        </div>
                        <span className="font-bold text-stone-900">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="bg-white border border-stone-200 rounded-xl p-6 shadow-sm">
              <h3 className="text-lg font-bold text-stone-900 mb-4">Quick actions</h3>
              <div className="flex flex-col gap-2">
                <QuickLink icon="inventory" label="View inventory" onClick={() => navigate('/seller/inventory')} />
                {canAnalytics && hasCap('report:read') && (
                  <QuickLink icon="monitoring" label="Open analytics" onClick={() => navigate('/seller/analytics')} />
                )}
                {hasCap('transfer:create') && (
                  <QuickLink icon="swap_horiz" label="New transfer" onClick={() => navigate('/seller/operations?tab=shipments')} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const KpiCard = ({ icon, label, value, accent }) => (
  <div className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 shadow-sm min-w-0 flex items-center gap-4">
    <span className="material-symbols-outlined text-[#EA2831] bg-[#EA2831]/10 h-11 w-11 rounded-xl flex items-center justify-center shrink-0">{icon}</span>
    <div className="min-w-0">
      <p className="text-stone-400 text-[10px] font-bold uppercase mb-1 tracking-wider truncate">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold leading-tight break-words ${accent || 'text-stone-900'}`}>{value}</p>
    </div>
  </div>
);

const StatCard = ({ label, value, accent }) => (
  <div className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 hover:shadow-md transition-all">
    <p className="text-stone-500 text-xs sm:text-sm font-medium mb-2">{label}</p>
    <p className={`text-2xl sm:text-3xl font-bold ${accent || 'text-stone-900'}`}>{value}</p>
  </div>
);

const QuickLink = ({ icon, label, onClick }) => (
  <button onClick={onClick} className="text-sm font-semibold text-stone-600 hover:text-stone-900 hover:bg-stone-50 p-3 rounded-xl flex items-center gap-3 transition-all text-left">
    <span className="material-symbols-outlined text-xl text-[#EA2831]">{icon}</span> {label}
  </button>
);

export default SellerDashboard;
