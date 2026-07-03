# Khetify Redesign — Implementation Notes

This is the companion to `docs/REDESIGN-PLAN.md`. It lists exactly what changed,
how to run it, and what still needs your local verification. All changes follow
the invariants in `CLAUDE.md` (append-only ledger, Inventory unique index,
multi-tenancy, no renamed/removed existing API routes — only additions).

## What changed

### Navigation — card-based Hub replaces the sidebar  *(highest priority)*
- `khetifyApp/src/lib/nav.js` — **new** single source of truth for the IA
  (`MODULES`, `ADMIN_ITEMS`, `activeModule()`).
- `khetifyApp/src/pages/Company/Hub.jsx` — **new** card launchpad (landing
  screen): KPI strip + one card per module, each with a headline metric and a
  pending-actions badge. Cards are gated by capability + subscription exactly
  like the old menu.
- `khetifyApp/src/Components/TopNav.jsx` — **new** slim top bar (logo → Home,
  Home button, breadcrumb, notifications, account).
- `khetifyApp/src/Components/DashboardLayout.jsx` — rewritten to use `TopNav`;
  the heavy left sidebar is gone.
- `khetifyApp/src/Components/Sidebar.jsx` — **deleted**.
- Post-login now lands on `/hub` (updated in `CompanyLogin`, `Billing`,
  `CompanySubmissionComplete`, `CompanyApprovalSuccess`).

### Single unified dashboard with time-range filter
- `khetifyApp/src/pages/Company/CompanyDashboard.jsx` — added a Daily / Weekly /
  Monthly / Quarterly / Yearly / Custom filter that drives the headline numbers
  via `GET /api/reports/dashboard?from&to`. The Executive/P&L widget is folded
  in here (admins only). **Also fixed a pre-existing syntax error**: a P&L JSX
  block was sitting outside the component's `return` (the file would not have
  compiled as uploaded).
- `controller/Analytics/reportController.js` — `dashboard` now accepts optional
  `from`/`to` and returns `rangeSales`/`rangeOrders` (legacy `todaySales`/
  `todayOrders` kept; numbers identical when no range is passed).
- Separate dashboards removed: `OwnerDashboard.jsx` deleted; `/ims/owner`
  redirects to `/analytics`.

### Removed modules — Locations & Counts
- `khetifyApp/src/pages/Company/ims/ImsLocations.jsx` and `ImsCounts.jsx`
  **deleted**; nav entries gone; `/ims/locations` and `/ims/counts` redirect to
  `/hub`.
- Backend: `/api/cycle-counts` **unmounted** in `Server.js`.
- **Locations data API is intentionally retained** (`/api/locations` still
  mounted): the active Operations → Receive Stock flow uses storage bins. Only
  the user-facing Locations *management module* was removed, which keeps the app
  functional. Model/service files are left in place for data integrity.

### Merged modules
- `khetifyApp/src/pages/Company/ims/InventoryTracking.jsx` — **new** tabbed
  module: Stock · Lots · Batches · Numbering (wraps `CompanyInventory`,
  `ImsLots`, `ImsLotDashboard`; Numbering links to the single Settings config).
- `khetifyApp/src/pages/Company/ims/Operations.jsx` — **new** tabbed module:
  Receive Stock · Send Stock · Shipment Tracking & Transfers · Traceability
  (wraps `ImsInbound`, `ImsOutbound`, `ImsTransport`, `ImsTrace`). Warehouse
  jargon replaced with business language.
- `khetifyApp/src/pages/Company/Administration.jsx` — **new** card hub for
  products, sellers, customers, team, settings, billing, integrations, support.
- Old deep links (`/ims/lots`, `/ims/inbound`, …) redirect into the new modules
  with the correct `?tab=`.

### Order History  *(new module)*
- `controller/Order/orderController.js` — **new** `getHistory` unioning Orders,
  TransferRequests and Shipments into one normalized, filterable shape with a
  status timeline.
- `routes/Order/orderRoutes.js` — `GET /api/orders/history` mounted **before**
  `/:id` (so "history" isn't parsed as an id).
- `khetifyApp/src/lib/imsApi.js` — `getOrderHistory(params)`.
- `khetifyApp/src/pages/Company/OrderHistory.jsx` — **new** page: filters
  (date, seller, warehouse, product, status, free-text) + expandable timeline.

### Product upload — custom category + bulk packaging
- `model/Company/productModel.js` — added `bulkPackaging { type, customType,
  capacity, capacityUnit }`. `category` stays free-text (custom values persist).
- `controller/Company/productController.js` — parses `bulkPackaging` JSON on
  create and update.
- `khetifyApp/src/pages/Company/CompanyUploadProduct.jsx` — "Other…" category
  with a custom-name input; Bulk Packaging Type (Carton/Bag/Box/Sack/Drum/
  Other) + Capacity Per Package (+unit).

### Barcode / labels — direct numeric input
- `khetifyApp/src/pages/Company/ims/ImsLabels.jsx` — the generate-quantity
  control now supports type, increment (+) and decrement (−), clamped 1–10000.

## How to run
```bash
# 1. MongoDB as a single-node replica set (transactions)
docker compose up -d mongo

# 2. Backend
cd khetify-backend && npm install && npm run seed   # if you use seed data
npm run dev        # http://localhost:5000

# 3. Frontend
cd ../khetifyApp && npm install && npm run dev        # http://localhost:5173
```

## What you must verify locally (I could not run a build here)
This environment had no network/DB, so I validated changes structurally
(backend `node --check` passed on all changed files; frontend bracket/brace
tokenizing passed). Before release, please run:

```bash
cd khetify-backend && npx eslint . && npm test
cd ../khetifyApp   && npm run build   # or: npm run lint
```

Specifically smoke-test: login → lands on Hub; each card opens its module;
Operations/Inventory tabs render; Order History filters; product upload with a
custom category + bulk packaging saves; barcode qty +/- and typing; old
bookmarked `/ims/*` URLs redirect correctly; Locations/Counts are gone from the
UI while Receive Stock (bins) still works.

## Not yet done (next iteration)
- Warehouse **profile** page (the spec's full Warehouse detail view) — today the
  Warehouses card still opens the existing `ImsWarehouses` list.
- Surfacing `bulkPackaging` on the catalog/inventory/lot **display** rows.
- Pruning unused cycle-count helpers from `imsApi.js` (left in place; harmless).
- New Jest tests for `GET /orders/history` and the product packaging fields.

---

## Round 2 — fixes from first review

1. **Period filter now actually works.** It previously only updated a small
   top-right strip. `orders/summary` is now range-aware (accepts `from`/`to`
   with adaptive daily/weekly/monthly trend buckets), and the dashboard
   re-fetches both `orders/summary` and `reports/dashboard` whenever the period
   changes — so Total/Orders, Sales overview, units, returns and the trend all
   react to Daily/Weekly/Monthly/Quarterly/Yearly/Custom. Sub-labels switch
   from "this week" to the selected period.

2. **Role-aware dashboard.** Sales widgets (Revenue, Orders, P&L, Sales
   overview, the period filter, "Today's Sales" headline, and the Hub revenue
   KPIs/Dashboard-card revenue) are gated behind `order:read`. An
   **operations_manager** (no `order:read`) instead sees an **Operations
   overview** panel (pending shipments, in-transit, open transfers, recent
   shipments) and a Pending-Shipments stat in place of Total Orders. Applied in
   `CompanyDashboard.jsx`, `SummaryCards.jsx` and `Hub.jsx`.

3. **API keys / Integrations removed.** Deleted `ImsIntegrations.jsx`, removed
   the Integrations entry from the Admin hub, and `/ims/integrations` now
   redirects to `/hub`. (Backend integration routes are left mounted but
   unreachable from the UI; unmount them in `Server.js` if you want them gone
   entirely.)

4. **Back-to-Home on every page.** The `TopNav` (present on every in-app page
   via `DashboardLayout`) now shows an explicit "← Back to Home" button that
   returns to the Hub.

---

## Round 3 — lot creation & scan-to-receive

- **Create Lot + Receive Lot, both for admin and operations manager.** The Lots
  tab now has two actions, gated by the `lot:receive` capability (held by both
  `company_admin` and `operations_manager`, not by sales-only roles):
  - **Create Lot** — manual entry (product, lot/batch, expiry, qty, warehouse).
  - **Receive Lot** — opens scan-first.
- **Scan during Receive Lot.** The Receive flow now shows a `ScanBox` (USB
  barcode scanner *and* device-camera scanning, the same component used for
  warehouse transfers/shipment verification). A scanned code that matches a
  product SKU/HSN auto-selects that product; any other code fills the lot
  number. Manual entry still works for everything.
- Both flows post to the existing `POST /api/lots/receive` (creates the lot row
  + stock ledger entry) — no backend change required.
