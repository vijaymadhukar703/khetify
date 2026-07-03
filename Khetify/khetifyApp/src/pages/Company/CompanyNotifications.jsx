import React, { useMemo, useState } from 'react';
import { useNotifications, NOTIF_ICON } from '../../hooks/useNotifications';

const TYPE_FILTERS = ['all', 'expiry', 'low_stock', 'order', 'shipment', 'supply_status'];
const TYPE_LABEL = {
  all: 'All', expiry: 'Expiry', low_stock: 'Low Stock', order: 'Orders',
  shipment: 'Shipments', supply_status: 'Supply',
};

const timeAgo = (d) => {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/** Full notification feed with filters + mark-as-read. */
const CompanyNotifications = () => {
  const { items, unread, markRead, markAll, scan } = useNotifications();
  const [filter, setFilter] = useState('all');

  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((n) => n.type === filter)),
    [items, filter]
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-3xl mx-auto space-y-6">

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-stone-900">Notifications</h2>
            <p className="text-xs text-stone-400">{unread} unread</p>
          </div>
          <div className="flex gap-2">
            <button onClick={scan} className="inline-flex items-center gap-1.5 border border-stone-200 hover:bg-stone-50 text-stone-700 text-xs font-bold rounded-lg px-3 py-2">
              <span className="material-symbols-outlined text-sm">refresh</span> Scan alerts
            </button>
            {unread > 0 && (
              <button onClick={markAll} className="inline-flex items-center gap-1.5 bg-[#EA2831] hover:bg-[#c91e26] text-white text-xs font-bold rounded-lg px-3 py-2">
                Mark all read
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {TYPE_FILTERS.map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`text-xs font-bold px-4 py-2 rounded-full border transition-colors ${
                filter === k ? 'bg-[#EA2831] border-[#EA2831] text-white' : 'border-stone-200 text-stone-500 hover:bg-stone-50'
              }`}
            >
              {TYPE_LABEL[k]}
            </button>
          ))}
        </div>

        <div className="border border-stone-200 rounded-2xl overflow-hidden divide-y divide-stone-100">
          {visible.length === 0 && (
            <p className="text-sm text-stone-400 text-center py-12">Nothing here yet.</p>
          )}
          {visible.map((n) => {
            const meta = NOTIF_ICON[n.type] || { icon: 'notifications', cls: 'text-stone-500 bg-stone-100' };
            return (
              <button
                key={n._id}
                onClick={() => { if (!n.read) markRead(n._id); }}
                className={`w-full text-left flex gap-4 px-5 py-4 hover:bg-stone-50 transition-colors ${n.read ? '' : 'bg-red-50/30'}`}
              >
                <span className={`material-symbols-outlined h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${meta.cls}`}>{meta.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-stone-900">{n.title}</p>
                    <span className="text-[10px] text-stone-400 whitespace-nowrap">{timeAgo(n.createdAt)}</span>
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5">{n.body}</p>
                </div>
                {!n.read && <span className="mt-1.5 h-2 w-2 rounded-full bg-[#EA2831] shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CompanyNotifications;
