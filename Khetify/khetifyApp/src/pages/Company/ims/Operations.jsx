import React from 'react';
import { useSearchParams } from 'react-router-dom';
import ImsInbound from './ImsInbound';
import ImsOutbound from './ImsOutbound';
import ImsTransport from './ImsTransport';
import ImsTrace from './ImsTrace';

// OPERATIONS — one module that merges the old Inbound, Outbound, Transport and
// Traceability pages. Warehouse jargon (inbound / outbound / putaway) is
// replaced with plain business language. The active tab is held in the URL
// (?tab=receive) so old deep links can redirect straight into the right tab.

const TABS = [
  { key: 'receive', label: 'Receive Stock', icon: 'move_to_inbox', render: () => <ImsInbound /> },
  { key: 'send', label: 'Send Stock', icon: 'outbox', render: () => <ImsOutbound /> },
  { key: 'shipments', label: 'Shipment Tracking & Transfers', icon: 'local_shipping', render: () => <ImsTransport /> },
  { key: 'trace', label: 'Traceability', icon: 'travel_explore', render: () => <ImsTrace /> },
];

const Operations = () => {
  const [params, setParams] = useSearchParams();
  const active = TABS.find((t) => t.key === params.get('tab')) || TABS[0];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Operations</h1>
      <p className="text-stone-500 mb-5">Receive, send, transfer and track your stock.</p>

      <div className="flex gap-1 border-b border-stone-200 mb-6 overflow-x-auto">
        {TABS.map((t) => (
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
