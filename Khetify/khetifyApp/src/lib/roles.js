// Mirror of backend config/permissions.js — keep in sync.
//
// Operational roles are consolidated to three: company_admin,
// operations_manager and sales_manager. Only these are offered when
// creating/updating team members (matches backend ASSIGNABLE_ROLES).
// super_admin is platform-reserved and intentionally NOT offered.
export const ROLE_OPTIONS = [
  { value: "company_admin", label: "Company Admin" },
  { value: "operations_manager", label: "Operations Manager" },
  { value: "sales_manager", label: "Sales Manager" },
];

// Legacy roles still exist on older user records — keep their labels so the
// team list renders them nicely even though they can't be assigned anymore.
const LEGACY_ROLE_LABELS = {
  warehouse_manager: "Warehouse Manager (legacy)",
  warehouse_operator: "Warehouse Operator (legacy)",
  inventory_manager: "Inventory Manager (legacy)",
  transport_manager: "Transport Manager (legacy)",
  driver: "Driver",
  pos_operator: "POS Operator (legacy)",
  support: "Customer Support (legacy)",
  auditor: "Auditor (read-only)",
};

export const ROLE_LABEL = {
  ...LEGACY_ROLE_LABELS,
  ...Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label])),
};

// Pretty-print a role even if it's a legacy/unknown value (e.g. inventory_staff).
export const roleLabel = (value) =>
  ROLE_LABEL[value] ||
  (value ? value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—");

// COMPANY WAREHOUSE roles — warehouse-scoped users who receive, pick, pack and
// dispatch stock, as opposed to the MAIN COMPANY account (company_admin).
// Mirrors backend config/permissions.js. Single source of truth for the
// warehouse-only UI branches (Inventory, Supply Requests).
export const WAREHOUSE_ROLES = new Set([
  "operations_manager", // active consolidated warehouse/operations role
  "warehouse_manager",  // legacy warehouse manager
  "warehouse_operator", // legacy warehouse operator
  "inventory_manager",  // legacy inventory manager
]);
export const isWarehouseRole = (role) => WAREHOUSE_ROLES.has(role);
