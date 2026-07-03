import React from "react";
import { usePermission } from "../../context/PermissionContext";

/**
 * Shown in place of (or over) a premium feature for free-plan users.
 * Subscription is the COMPANY ADMIN's concern: only the admin sees plan info
 * and the upgrade button. Other roles get a neutral message with no billing
 * or purchase controls at all.
 */
const UpgradeCard = ({ feature = "This feature", plan = "Pro" }) => {
  // billing:manage resolves only via the company_admin "*" wildcard.
  const isAdmin = usePermission("billing:manage");

  if (!isAdmin) {
    return (
      <div className="border border-dashed border-stone-200 bg-stone-50/50 rounded-2xl p-8 text-center">
        <h3 className="text-lg font-bold text-stone-900 mb-1">{feature} isn&apos;t enabled</h3>
        <p className="text-sm text-stone-500">
          This module isn&apos;t part of your company&apos;s plan yet. Please contact your company admin.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-dashed border-[#EA2831]/30 bg-[#EA2831]/5 rounded-2xl p-8 text-center">
      <div className="inline-flex items-center gap-2 text-[#EA2831] font-bold text-xs uppercase tracking-widest mb-2">
        <span className="material-symbols-outlined text-base">lock</span>
        {plan} feature
      </div>
      <h3 className="text-lg font-bold text-stone-900 mb-1">{feature} is locked</h3>
      <p className="text-sm text-stone-500 mb-5">
        Upgrade your plan to unlock {feature.toLowerCase()}.
      </p>
      <button
        onClick={() => (window.location.href = "/billing")}
        className="px-6 py-2.5 text-sm font-bold bg-[#EA2831] text-white rounded-xl hover:bg-black transition-all"
      >
        Upgrade to {plan}
      </button>
    </div>
  );
};

export default UpgradeCard;
