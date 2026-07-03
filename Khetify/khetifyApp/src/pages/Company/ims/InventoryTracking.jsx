import React from 'react';
import { useSearchParams } from 'react-router-dom';
import CompanyInventory from '../CompanyInventory';
import ImsLots from './ImsLots';
import ImsLotDashboard from './ImsLotDashboard';

// INVENTORY TRACKING — one module merging Stock Overview, Lot Management, and
// Batch Management.

const TABS = [
  { key: 'stock', label: 'Stock', icon: 'list_alt', render: () => <CompanyInventory /> },
  { key: 'lots', label: 'Lots', icon: 'package_2', render: () => <ImsLots /> },
  { key: 'batches', label: 'Batches', icon: 'monitoring', render: () => <ImsLotDashboard /> },
];

const InventoryTracking = () => {
  const [params, setParams] = useSearchParams();
  const active = TABS.find((t) => t.key === params.get('tab')) || TABS[0];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Inventory</h1>
      <p className="text-stone-500 mb-5">Track stock on hand, lots and batches.</p>

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

export default InventoryTracking;
