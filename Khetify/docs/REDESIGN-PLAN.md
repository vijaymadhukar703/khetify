# Khetify IMS — UI/UX Restructure & Consolidation Plan

This document is the design specification that precedes implementation. It is grounded
in the actual codebase (Express 5 / Mongoose backend, React 18 + Vite + Tailwind
frontend) and respects the non-negotiable invariants in `CLAUDE.md` — append-only
StockMovement ledger, the Inventory unique index, transactional multi-doc writes,
multi-tenancy by `companyId`, subscription gating via `config/plans.js`, and **no
renaming of existing API routes / response shapes** (we add, we don't break).

The guiding principle of the redesign: **fewer destinations, business language, and a
card-based home** instead of a deep capability-gated sidebar.

---

## 1. Updated Information Architecture

### Before (today)
A single left sidebar exposes ~20 destinations across nested dropdowns and capability
gates: Dashboard, Products (Upload, Catalog), Inventory (Stock Overview, Lot Dashboard,
Lots & Batches, Warehouses, Locations, Transport, Analytics, Purchasing), Warehouse Ops
(Inbound & Putaway, Outbound, Counts & Adjustments, Barcodes & Labels), Seller, Orders,
Customers, Trace, Support, Executive, Integrations, Team & Roles, Settings — plus three
separate dashboards (Company, Executive/Owner, Analytics).

### After (target) — 6 top-level modules + Home
The post-login screen is a **Hub** (card launchpad) with a compact KPI strip on top and
one card per module. Everything collapses into six business-language modules:

```
HOME (Hub launchpad — KPI strip + module cards)
│
├── DASHBOARD            one unified dashboard, time-range filter, role widgets
│
├── INVENTORY            (merge of Stock Overview + Lot Dashboard + Lots & Batches
│   "Inventory Tracking"  + Lot Numbering)  → tabs: Stock · Lots · Batches · Numbering
│
├── WAREHOUSES           warehouse cards → full warehouse profile page
│
├── OPERATIONS           (merge of Inbound + Outbound + Transport + Traceability)
│   business language      → tabs: Receive Stock · Send Stock · Transfer Stock ·
│                                  Shipment Tracking · Traceability
│
├── ORDERS               live order workspace (create / approve / pack / dispatch)
│   └── ORDER HISTORY     dedicated, searchable history across all order types
│
├── ANALYTICS            reports + advanced analytics (folds in Executive widgets)
│
└── ADMINISTRATION       Products (Upload/Catalog), Sellers, Customers, Team & Roles,
                          Settings, Billing, Integrations, Support
```

**Removed entirely:** `Locations` and `Counts` (Cycle Counts) — navigation, routes, UI
pages, and nav registry entries. See §3 for the safe backend removal strategy.

---

## 2. Updated Navigation Structure

The heavy `Sidebar.jsx` is retired as the primary navigation. It is replaced by:

1. **`TopNav`** — a slim top bar: Khetify wordmark (→ Home), a Home/Modules button, a
   breadcrumb of the active module, notifications bell, and the account menu. Full-width
   content below it; no permanent sidebar.
2. **`Hub`** — the card launchpad and the default landing route (`/hub`). Each card shows
   feature name, a one-line description, a headline KPI, and a pending-actions badge.
3. **Module sub-navigation** — merged modules use an in-page **tab strip** (e.g.
   Operations → Receive / Send / Transfer / Tracking / Traceability) instead of separate
   sidebar links.

A single source of truth for the IA lives in **`src/lib/nav.js`** (`MODULES` array):
each module declares `key, title, path, icon, description, capability, feature` so the
Hub, TopNav, and route guards all read the same list. Capability + subscription gating is
preserved exactly (cards the role/plan can't use are hidden, same rules as today).

### Route map (App.jsx)

| New path                | Renders                          | Replaces / notes |
|-------------------------|----------------------------------|------------------|
| `/hub`                  | `Hub`                            | new landing; post-login redirect |
| `/company-dashboard`    | `CompanyDashboard` (unified)     | the only dashboard |
| `/inventory`            | `InventoryTracking` (tabbed)     | merges `/inventory`, `/ims`, `/ims/lots`, lot numbering |
| `/warehouses`           | `ImsWarehouses`                  | was `/ims/warehouses`; card → profile |
| `/operations`           | `Operations` (tabbed)            | merges `/ims/inbound`, `/ims/outbound`, `/ims/transport`, `/ims/trace` |
| `/orders`               | `CompanyOrders`                  | unchanged live workspace |
| `/order-history`        | `OrderHistory`                   | **new** dedicated module |
| `/analytics`            | `ImsAnalytics` (+ exec widgets)  | merges `/ims/analytics`, `/ims/owner` |
| `/admin`                | `Administration` (hub-of-cards)  | groups products, sellers, customers, team, settings, billing, integrations |
| `/ims/locations`        | → redirect `/hub`                | **removed** |
| `/ims/counts`           | → redirect `/hub`                | **removed** |

Old deep paths (`/ims/lots`, `/ims/inbound`, …) are kept as **redirects** to the new
merged module + tab so existing bookmarks and in-app links don't 404 (backwards-compatible).

---

## 3. Updated Database Changes

All changes are **additive** to preserve the Inventory unique index and the ledger.

### 3.1 Product — custom category + bulk packaging (`model/Company/productModel.js`)
`category` is already a free-text `String`, so a custom **"Other"** value persists with no
schema change — the work is in the upload form (offer "Other" → text input) and making the
controller accept any string. We **add** structured bulk-packaging fields:

```js
bulkPackaging: {
  type:        { type: String },   // Carton | Bag | Box | Sack | Drum | Other | <custom>
  customType:  { type: String },   // free text when type === "Other"
  capacity:    { type: Number },   // units per package, e.g. 50
  capacityUnit:{ type: String, default: "units" },
}
```
Displayed wherever a product/lot is shown (catalog, inventory rows, lot detail).

### 3.2 Order history
No new collection is required. History is an **aggregation/union view** over existing
collections already scoped by `companyId`:
- `Order` (seller/customer orders, completed, cancelled)
- `TransferRequest` (warehouse-to-warehouse transfers)
- `Shipment` (shipment/dispatch history)

A read-only endpoint normalizes these into one shape with a status **timeline**
(`created → approved → packed → dispatched → delivered`). If desired later, a denormalized
`OrderHistory` materialized collection can be added, but it is **not** needed for v1 and
would duplicate the ledger.

### 3.3 Lot numbering — already "configure once"
`Company.imsSettings.lotNumberingMethod` + `lotNumberFormat` already store the format once
and `lotService` reuses it on every receipt. The redesign only **surfaces** this in the
Inventory → Numbering tab and Settings; no schema change.

### 3.4 Removed dependencies (Locations, Counts)
- `model/Warehouse/Location.js` and `model/Inventory/CycleCount.js` collections are **left
  in place** (dropping collections risks data loss and breaks historical references); we
  stop **mounting their routes** and remove all UI. This satisfies "no longer appears
  anywhere" for users while maintaining data integrity. `InventoryBin` (the real storage
  dimension) is unaffected. A follow-up migration can archive Location/CycleCount data if
  the business confirms it is disposable.

---

## 4. Updated API Changes

Additive only. Existing routes and response shapes are untouched.

| Method & path                  | Status   | Purpose |
|--------------------------------|----------|---------|
| `GET /api/orders/history`      | **new**  | Unified, filterable order history (Orders ∪ Transfers ∪ Shipments) with timeline. Query: `from,to,type,status,warehouseId,sellerId,productId,q,limit`. |
| `POST /api/product/*`          | extended | Accept `bulkPackaging{…}` and arbitrary `category` (incl. custom). |
| `PUT /api/product/*`           | extended | Same fields editable. |
| `GET /api/reports/dashboard`   | extended | Accept `from`/`to` (and a `period` convenience) so the unified dashboard's Daily/Weekly/Monthly/Quarterly/Yearly/Custom filter drives the numbers. Defaults unchanged when no range passed (backwards-compatible). |
| `locations/*` routes           | unmounted| `/api/locations*` no longer served. |
| `cycle-counts/*` routes        | unmounted| `/api/cycle-counts*` no longer served. |

Frontend `src/lib/imsApi.js` gains: `getOrderHistory(params)`; `getDashboardSummary` is
extended to forward `{ from, to }`. Removed helpers: `getLocations`, `getLocationBins`,
`createLocation`, `generateLocations`, `moveBinStock`, and the cycle-count helpers
(`getCycleCounts`, `generateCount`, …) — kept as thin no-op stubs only if any shared
component still imports them, otherwise deleted.

---

## 5. Updated UI Wireframes (ASCII)

### 5.1 Hub (landing)
```
┌───────────────────────────────────────────────────────────────────┐
│ Khetify          Home · Dashboard                       🔔   (AS) ▾ │  TopNav
├───────────────────────────────────────────────────────────────────┤
│  Good morning, Anuj — here's your business at a glance.             │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                        │  KPI strip
│  │Revenue │ │Orders  │ │Inv.Val │ │Alerts  │                        │
│  │₹4.2L   │ │128     │ │₹38.7L  │ │ 6      │                        │
│  └────────┘ └────────┘ └────────┘ └────────┘                        │
│                                                                     │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                    │
│  │ 📊 Dashboard│ │ 📦 Inventory│ │ 🏬 Warehouses│                   │  Cards
│  │ KPIs & trend│ │ Stock·Lots  │ │ 4 sites      │                   │  (name,
│  │ ▸ open      │ │ 6 low stock │ │ 78% capacity │                   │   desc,
│  └─────────────┘ └─────────────┘ └─────────────┘                    │   KPI,
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                    │   pending)
│  │ 🔁 Operations│ │ 🛒 Orders   │ │ 🕘 Order Hist│                   │
│  │ Receive·Send│ │ 12 pending  │ │ all activity │                   │
│  │ 3 shipments │ │ ▸ approve   │ │ ▸ search     │                   │
│  └─────────────┘ └─────────────┘ └─────────────┘                    │
│  ┌─────────────┐ ┌─────────────┐                                    │
│  │ 📈 Analytics│ │ ⚙ Admin     │                                    │
│  └─────────────┘ └─────────────┘                                    │
└───────────────────────────────────────────────────────────────────┘
```

### 5.2 Unified Dashboard (one only)
```
┌───────────────────────────────────────────────────────────────────┐
│ Dashboard                              [Daily|Weekly|Monthly|Qtr|   │
│                                         Yearly|Custom ▾]  ⟳          │  range filter
├───────────────────────────────────────────────────────────────────┤
│ Revenue   Orders   Inv. Value   Low Stock   Expiring Lots           │
│ ┌──────────────────────────────┐ ┌───────────────────────────────┐ │
│ │ Inventory trend (range-aware)│ │ Warehouse summary             │ │
│ └──────────────────────────────┘ └───────────────────────────────┘ │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────────┐ │
│ │ Top products │ │ Top sellers  │ │ Transport cost               │ │
│ └──────────────┘ └──────────────┘ └──────────────────────────────┘ │
│ (admin-only widgets — P&L snapshot — appear inline for admins)      │
└───────────────────────────────────────────────────────────────────┘
```

### 5.3 Inventory Tracking (merged, tabbed)
```
Inventory Tracking
[ Stock ] [ Lots ] [ Batches ] [ Numbering ]
Lot list columns (consistent everywhere):
Category │ Product │ Lot Number │ Expiry Date │ Warehouse
Seeds    │ Wheat Seeds │ LOT-2026-001 │ 31-Dec-2026 │ Bhopal Warehouse
```

### 5.4 Operations (merged, business language — no "inbound/putaway/outbound")
```
Operations
[ Receive Stock ] [ Send Stock ] [ Transfer Stock ] [ Shipment Tracking ] [ Traceability ]
```

### 5.5 Warehouse profile (card → full page)
```
Bhopal Warehouse                                   Manager: R. Verma
Capacity 78% ▓▓▓▓▓▓▓░░   Inventory value ₹12.4L    Lots stored 214
[ Current Inventory ] [ Transfers ] [ Recent Activity ]
Pending shipments (3) · Low-stock products (5)
```

### 5.6 Order History (new)
```
Order History            [Date▾][Seller▾][Warehouse▾][Product▾][Status▾]  🔍 search
Order#  Type        Party        Status      Total      Date
SO-1042 Seller      Agro Mart    Delivered   ₹18,400    02-Jun
TR-0210 Transfer    Bhopal→Indore Dispatched  —          01-Jun
…
Row expand → timeline: Created → Approved → Packed → Dispatched → Delivered
```

### 5.7 Barcode / labels — direct numeric input
```
Generate quantity: [  100  ]  [−] [+]      (type, increment, or decrement)
```

---

## 6. Implementation order (systematic)
1. **IA + navigation shell** — `nav.js`, `Hub`, `TopNav`, `DashboardLayout` swap, `App.jsx`
   route map (+ redirects), remove Locations/Counts from nav & routes. *(highest priority)*
2. **Merged module shells** — `InventoryTracking`, `Operations` (tabbed wrappers reusing
   existing pages; rename labels to business language).
3. **Unified dashboard** — time-range filter wired to `getDashboardSummary({from,to})`.
4. **Order History** — backend `GET /orders/history` + `OrderHistory.jsx`.
5. **Product upload** — "Other" category + bulk packaging (schema + form + display).
6. **Barcode** — direct numeric input on the labels screen.
7. **Backend cleanup** — unmount `locations`/`cycle-counts` routes; extend product
   controller/validators for packaging.
8. **Tests** — extend Jest suites for the new endpoint and product fields; run
   `npm test` + `npx eslint .` locally before release.
