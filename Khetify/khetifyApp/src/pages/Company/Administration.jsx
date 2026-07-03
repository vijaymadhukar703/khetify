import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ADMIN_ITEMS } from '../../lib/nav';
import { useSubscription, FEATURES } from '../../context/SubscriptionContext';
import { usePermission } from '../../context/PermissionContext';

// ADMINISTRATION — a card hub that groups the lower-frequency setup screens
// (products, sellers, customers, team, settings, billing, integrations,
// support) so they're out of the way of daily work but easy to find.
const Administration = () => {
  const navigate = useNavigate();
  const { has } = useSubscription();
  const { can, loading } = usePermission();

  const visible = (item) => {
    if (item.feature === FEATURES.API_ACCESS && !has(FEATURES.API_ACCESS)) return false;
    if (item.capability && !loading && !can(item.capability)) return false;
    return true;
  };

  const items = ADMIN_ITEMS.filter(visible);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Administration</h1>
      <p className="text-stone-500 mb-7">Set up products, people and company preferences.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className="group text-left bg-white border border-stone-200 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-[#EA2831]/40 transition-all"
          >
            <div className="h-11 w-11 rounded-xl bg-[#EA2831]/10 flex items-center justify-center text-[#EA2831] mb-4">
              <span className="material-symbols-outlined text-[24px]">{item.icon}</span>
            </div>
            <h3 className="text-base font-bold text-stone-900 mb-1">{item.title}</h3>
            <p className="text-sm text-stone-500 leading-snug">{item.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
};

export default Administration;
