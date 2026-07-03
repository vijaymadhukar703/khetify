import React from 'react';
import { useNavigate } from 'react-router-dom';
import { SELLER_ADMIN_ITEMS } from '../../lib/sellerNav';
import { useSellerPermission } from '../../context/SellerPermissionContext';

// SELLER ADMINISTRATION — a card hub that groups the seller's lower-frequency
// setup screens (team, certifications, billing, customers, companies), mirroring
// the company Administration hub. Each card keeps its own route + capability
// gate; the hub only groups them.
const SellerAdministration = () => {
  const navigate = useNavigate();
  const { sellerCan } = useSellerPermission();

  const items = SELLER_ADMIN_ITEMS.filter((item) => sellerCan(item.cap));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8 font-sora">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Administration</h1>
      <p className="text-stone-500 mb-7">Manage your team, certifications, plan and partners.</p>

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
        {items.length === 0 && (
          <p className="text-sm text-stone-400 col-span-full py-10 text-center">No administration tools available for your role.</p>
        )}
      </div>
    </div>
  );
};

export default SellerAdministration;
