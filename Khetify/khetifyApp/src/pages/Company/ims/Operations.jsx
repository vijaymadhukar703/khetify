import React from 'react';
import { useSearchParams } from 'react-router-dom';
import ImsInbound from './ImsInbound';
import ImsOutbound from './ImsOutbound';
import ImsTransport from './ImsTransport';
import ImsTrace from './ImsTrace';
import { usePermission } from '../../../context/PermissionContext';
import { WAREHOUSE_ROLES } from '../../../lib/roles';

// OPERATIONS — one module that merges the old Inbound, Outbound, Transport and
// Traceability pages. Warehouse jargon (inbound / outbound / putaway) is
// replaced with plain business language. The active tab is held in the URL
// (?tab=receive) so old deep links can redirect straight into the right tab.
//
// Per-role tab sets (nothing is removed globally — ImsInbound / ImsOutbound,
// their routes and their APIs are untouched):
//  - MAIN COMPANY (company_admin): oversight only, no stock handling.
//  - COMPANY WAREHOUSE: no "Receive Stock" tab — it receives Company-transferred
//    parent lots through Inventory → Receive Lot (scan + Confirm Receive)
//    instead. That flow is a different feature and is NOT affected here.
//  - Everyone else: the full set, unchanged.

const TABS = [
  { key: 'receive', label: 'Receive Stock', icon: 'move_to_inbox', render: () => <ImsInbound /> },
  { key: 'send', label: 'Send Stock', icon: 'outbox', render: () => <ImsOutbound /> },
  { key: 'shipments', label: 'Shipment Tracking & Transfers', icon: 'local_shipping', render: () => <ImsTransport /> },
  { key: 'trace', label: 'Traceability', icon: 'travel_explore', render: () => <ImsTrace /> },
];
// Tabs the main Company may open (oversight only — no stock handling).
const COMPANY_TABS = ['shipments', 'trace'];
// The Company Warehouse keeps everything except Receive Stock.
const WAREHOUSE_TABS = ['send', 'shipments', 'trace'];

const Operations = () => {
  const { role } = usePermission();
  const isMainCompany = role === 'company_admin';
  const isWarehouse = WAREHOUSE_ROLES.has(role);
  const allowed = isMainCompany ? COMPANY_TABS : isWarehouse ? WAREHOUSE_TABS : null;
  const tabs = allowed ? TABS.filter((t) => allowed.includes(t.key)) : TABS;
  // Resolve the active tab against the VISIBLE list, so ?tab=receive / ?tab=send
  // can't open a hidden tab — the role falls back to its first allowed tab
  // (Company → Shipment Tracking, Warehouse → Send Stock) with no manual switch.
  const [params, setParams] = useSearchParams();
  const active = tabs.find((t) => t.key === params.get('tab')) || tabs[0];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Operations</h1>
      <p className="text-stone-500 mb-5">
        {isMainCompany
          ? 'Track your transfers and trace your stock.'
          : isWarehouse
            ? 'Send, transfer and track your stock. Incoming lots are received from Inventory → Receive Lot.'
            : 'Receive, send, transfer and track your stock.'}
      </p>

      <div className="flex gap-1 border-b border-stone-200 mb-6 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setParams({ tab: t.key })}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px whitespace-nowrap transition-colors ${
              active.key === t.key
                ? 'border-[#EA2831] text-[#EA2831]'
                : 'border-transparent text-stone-400 hover:text-stone-700'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div>{active.render()}</div>
    </div>
  );
};

export default Operations;
