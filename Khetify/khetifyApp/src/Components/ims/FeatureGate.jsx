import React from "react";
import { useSubscription } from "../../context/SubscriptionContext";
import UpgradeCard from "./UpgradeCard";

/**
 * Wrap any premium UI:
 *
 *   <FeatureGate feature={FEATURES.MULTI_WAREHOUSE} label="Multi-Warehouse">
 *     <WarehouseManager />
 *   </FeatureGate>
 *
 * Falls back to an UpgradeCard (or a custom `fallback`) when the plan
 * lacks the feature. NOTE: this is UX only — the backend is what actually
 * enforces access.
 */
const FeatureGate = ({ feature, label, plan = "Pro", fallback, children }) => {
  const { has, loading } = useSubscription();
  if (loading) return null;
  if (has(feature)) return <>{children}</>;
  return fallback ?? <UpgradeCard feature={label || "This feature"} plan={plan} />;
};

export default FeatureGate;
