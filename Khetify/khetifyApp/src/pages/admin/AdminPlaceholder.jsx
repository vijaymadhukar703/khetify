import React from 'react';
import { getAdminUser } from '../../lib/adminApi';

// Generic empty-state page for admin sections that are UI-only for now (Sellers)
// and the admin Profile. Keeps navigation working without pretending data exists.
const AdminPlaceholder = ({ title, subtitle, icon = 'construction', profile = false }) => {
  const admin = profile ? getAdminUser() : null;
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8">
      <h1 className="text-2xl font-bold text-stone-900">{title}</h1>
      {subtitle && <p className="text-stone-500 mb-6">{subtitle}</p>}

      {profile && admin ? (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6 max-w-md mt-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-[#EA2831]/10 border border-[#EA2831]/20 flex items-center justify-center font-bold text-[#EA2831] uppercase text-lg">
              {(admin.name || 'A').slice(0, 1)}
            </div>
            <div>
              <p className="text-lg font-bold text-stone-900">{admin.name}</p>
              <p className="text-sm text-stone-500">{admin.email}</p>
              <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider text-stone-400 bg-stone-100 rounded-full px-2 py-0.5">
                {admin.role || 'super_admin'}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm px-6 py-16 text-center mt-4">
          <span className="material-symbols-outlined text-4xl text-stone-300">{icon}</span>
          <p className="mt-2 text-sm font-semibold text-stone-500">Coming soon</p>
          <p className="text-xs text-stone-400">This section isn’t available yet.</p>
        </div>
      )}
    </div>
  );
};

export default AdminPlaceholder;
