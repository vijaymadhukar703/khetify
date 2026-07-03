# Khetify — Sprint 6 changes (role consolidation, receipt verification, camera scan, lot numbering, transport cost)

All changes are additive/incremental. No existing API routes were renamed, no
response shapes changed, and existing lot/shipment/user records keep working.

## 1. Role structure (3 operational roles)
- `config/permissions.js`: new **operations_manager** role (inventory, warehouses,
  locations, transport, inbound, outbound, counts & adjustments, labels,
  traceability). `sales_manager` unchanged (orders, customers, suppliers, sales
  analytics, traceability, read-only inventory). New `ASSIGNABLE_ROLES` export:
  only company_admin / operations_manager / sales_manager can be assigned.
- Legacy roles stay in the enum so existing users & JWTs keep working;
  `scripts/migrations/004-consolidate-roles.js` maps them when you choose.
- `validators/userValidators.js` restricts new role assignments; `model/User/User.js`
  default role is now operations_manager.
- Executive dashboard (`/api/owner/dashboard`) is now `executive:view`
  (company_admin + auditor) instead of any report:read role.
- Frontend: `lib/roles.js` offers the 3 roles (legacy labels preserved for
  display); `Components/ims/RequireCap.jsx` gives page-level protection and is
  applied to all role-gated routes in `App.jsx`; the sidebar hides Settings,
  Team & Roles, Executive, Orders, etc. per role. Backend `authorize()` keeps
  returning 403 for unauthorized API access.

## 2. Warehouse transfer receipt verification (priority POD)
- `model/Transport/Shipment.js`: status enum gains **partially_received** and
  **received**; `pod` gains `warehouseId` and method **scan_otp**.
- `services/shipmentService.verifyReceipt` now enforces: manifest barcode scan
  (HMAC) **and** receiving OTP; only the destination warehouse can verify (the
  source warehouse is explicitly rejected); driver cannot self-verify; GPS
  geofence at destination. Lots stay in transit until verified. Full receipt →
  `received`; shortage → `partially_received` + Discrepancy rows.
- POD stored on the shipment: verifiedBy, verifiedAt, warehouseId, method;
  the controller writes an audit entry with shipment + lot references for
  every verification (`shipment.verified`).
- Frontend `ImsTransport.jsx`: new receive flow — scan manifest (camera or
  wedge) → see lots on board (lot, product, qty, source → destination) →
  enter OTP → confirm.
- Tests updated (`tests/shipmentService.test.js`): OTP required, source
  warehouse rejected, new statuses.

## 3. Camera barcode scanning
- `Components/ims/CameraScanner.jsx`: getUserMedia preview + browser-native
  BarcodeDetector (no new dependencies, mobile-friendly, rear camera).
- `Components/ims/ScanBox.jsx`: optional camera button on every existing scan
  input (labels, outbound, transfer receipt). Graceful fallback message where
  the API is unsupported.

## 4. Custom lot numbering
- `model/Company/Company.js`: `imsSettings.lotNumberingMethod` —
  `company_defined` (default, legacy behaviour, e.g. UR-2026-JUN-001) or
  `khetify_generated` (e.g. KH-KHA-202606-0001).
- `services/lotService.js`: `generateKhetifyLotNumber()` (per company +
  warehouse + month via the atomic Counter); `receiveLot` auto-generates when
  the mode is khetify_generated and no batch number is given. GRN auto lot
  codes honour the same setting. Existing lot records untouched.
- New endpoints: `GET/PUT /api/company/settings/ims` (PUT is owner-only).
- Frontend: Settings page gains a "Lot Numbering Method" card; the Receive
  Lot modal makes batch/lot optional in khetify mode. Serial labels beneath a
  lot continue to work via the existing /api/units generator.
- New tests: `tests/lotNumbering.test.js`.

## 5. Transport cost in product costing
- `model/Costing/ProductCost.js`: new `purchaseCost`; `totalCost` now sums
  purchase + production + packaging + storage + transport, so
  **Total Cost = Purchase Cost + Transport Cost** for trading products.
  Existing documents default purchaseCost to 0 — fully backward compatible.
- Approval workflow (`costingService`) applies purchaseCost; Executive
  dashboard shows a Product Costing table (Purchase / Transport / Total),
  the cost-request modal includes purchase cost with a live total, and the
  product details page shows the approved Purchase / Transport / Total.

## Running checks
- `npm test` in khetify-backend (requires a platform-matching mongod binary
  for mongodb-memory-server; the bundled cache is Windows-only).
- `npm run build` in khetifyApp (node_modules in this archive were installed
  on Windows — reinstall on your platform if binaries mismatch).

## 6. Subscription-based feature access (SaaS hardening)
- **Billing is owner-only.** `POST /api/subscription/change` and
  `GET /api/subscription/payments` now require `billing:manage` (resolves only
  via the company_admin wildcard). `GET /api/subscription/me` stays open to all
  roles since it drives UI gating. The /billing page, Manage Plan, upgrade
  buttons and UpgradeCard purchase controls render only for the admin; other
  roles see neutral "not enabled — contact your admin" text, never plans or
  prices.
- **IMS is a subscribable module.** When the company is on the free plan, ALL
  IMS menus (Inventory, Stock Overview, Lot Dashboard, Lots & Batches,
  Warehouses, Locations, Transport, Analytics, Purchasing, Inbound & Putaway,
  Outbound, Counts & Adjustments, Barcodes & Labels, Trace) are hidden
  COMPLETELY for every role — no greyed-out items, no lock icons. The company
  admin instead sees a single "IMS Module Not Activated" sidebar entry and an
  activation screen (View Plan / Subscribe) on any IMS route; other roles get
  a neutral message. RequireCap gained an `ims` prop for this; backend
  requireFeature() keeps enforcing premium endpoints.
- **Products are admin-only master data.** Product create/update/delete routes
  now require `product:manage` (admin wildcard). Upload Product is removed
  from manager sidebars and dashboard quick actions; the edit/delete/add
  buttons in the Product Catalog render only for the admin. The catalog stays
  visible read-only for operations/sales managers.

## 7. IMS visibility fix + warehouse-level access control
### Root-cause fix (critical)
`subscription/me` and `loadSubscription` resolved the plan by `req.user.id` —
for team-member tokens that's the USER id, so managers never read the
company's real plan. Both now use `req.user.companyId` (owner tokens
unchanged: id === companyId). Combined with strict default-deny UI gating
(`canAccessInventory = imsSubscribed && roleHasInventoryPermission`, nothing
IMS-related renders while either check is loading), employees can no longer
see IMS menus, lock icons, or any subscription prompt. The dashboard shows
the admin an "IMS Module Not Activated" card (View Plan / Subscribe) and
shows managers role-specific widgets instead (sales: orders/revenue/top
customers; ops: pending shipments/open transfers/warehouse activity).

### Warehouse-level access control (extension of RBAC)
- `User.warehouseIds` (array, ref Warehouse): a warehouse can have many users
  and a user can later cover several warehouses — no future redesign needed.
  Empty = unscoped (legacy users keep working until assigned).
- `services/warehouseScope.js`: resolves a caller's scope; "*" roles and
  auditors are never scoped. Applied to: warehouse list, lots, shipments
  (from OR to in scope → an ops manager only sees their warehouse's incoming
  transfers), GRN list/create, and receipt verification.
- Team & Roles: assign an operations manager to a warehouse (create + inline
  change); assignments are audited and carried in the login JWT + /auth/me.
- Receiving flow: Receive Lot → camera scan → the system validates
  scanned-lot destination == the logged-in manager's assigned warehouse
  ("Verification successful" / "Access Denied — Wrong Warehouse") → lots
  shown → Receive. OTP is now OPTIONAL (validated when supplied; schema/API
  unchanged so it can be made mandatory later). Enforced on the backend too.
- Lifecycle: planned(created) → approved (new status + POST
  /api/shipments/:id/approve) → dispatched/in_transit → arrived →
  barcode-scanned (logged as a "verifying" event) → received (stock updated).
  Every status event records user, timestamp and warehouse.
- Transport page: "Incoming Transfers" filter, Approve action, and the
  warehouse-validated receive modal.

## 8. Admin ↔ manager data integration (one source of truth)
A scoped operations manager now sees exactly the slice of the admin's data
for their assigned warehouse — same collections, same math, filtered by the
warehouseScope service. Newly integrated surfaces (lots/shipments/GRNs were
already scoped):
- GET /api/inventory — inventory rows restricted to assigned warehouses.
- GET /api/locations + cycle counts — per-warehouse, with 403 on an explicit
  out-of-scope warehouseId.
- GET /api/reports/:name — every warehouse-filterable report (stock on hand,
  aging, expiry risk, movement register, warehouse utilization) accepts the
  injected scope, so the Khargone manager's "stock on hand" equals the
  admin's report filtered to Khargone.
- GET /api/reports/dashboard — headline numbers (stock value, expiring value,
  open shipments) computed within the scope; orders stay company-wide since
  they aren't warehouse-bound.
- Stock Overview (/ims) shows a "Showing stock for your warehouse: Khargone"
  banner for scoped users, making the shared-data slice explicit.

## 9. Integration root-cause fix: company scope for team tokens
Legacy controllers read `req.user.id` AS the companyId (true only for owner
tokens). For team-member tokens `id` is the USER id, so managers' queries on
lots, inventory, orders, warehouses, analytics, transport, supply, purchasing
and notifications matched nothing — managers saw EMPTY data while the admin
saw stock, which looked like "not integrated". Every company-scope read now
uses `req.user.companyId` (falls back to id for legacy owner tokens, so admin
behaviour is byte-identical). Actor fields (performedBy, enteredBy,
recipientId, verifierId) still use the user id.

Also: services/warehouseScope.js now ALWAYS reads the live User doc — JWTs
carry a login-time snapshot of warehouseIds, so warehouse (re)assignment now
applies immediately without the manager logging out and back in. Scoped users
can also no longer receive lots into another warehouse (403). New regression
suite tests/warehouseScope.test.js locks the integration property in: the
Khargone manager's lot rows are exactly the admin's Khargone slice.

## 10. Warehouse directory for transfer destinations
A scoped manager's transfer/shipment DESTINATION pickers were empty: the
scoped warehouse list only contains their own warehouse, which is excluded as
the source. New `GET /api/warehouse?directory=1` returns every company
warehouse (name/code/address only — no stock, capacity or geofence data) for
any authenticated team member, used by the Transfer Lot and New Shipment "To
warehouse" pickers. The "From warehouse" picker and all data views stay
scoped. The transfer endpoint also gained guards: the source lot must belong
to the company, a scoped manager can only transfer OUT of their own warehouse
(403 otherwise), and the destination must be a company warehouse.

## 11. Warehouse governance, stock requests, camera-first receiving
- **Warehouse creation is admin-only**: POST /api/warehouse now requires
  warehouse:manage (admin wildcard); the Add Warehouse button is hidden from
  operations managers.
- **Inter-warehouse stock requests**: new TransferRequest model +
  /api/transfer-requests endpoints and a "Requests" tab in Transport.
  Warehouse B requests qty × product from warehouse A → A's team gets the
  request notification → A accepts/rejects → B sees the acknowledgment and is
  notified → the company admin is notified at every step. Scoped: only A's
  team can decide; B requests for their own warehouse. All steps audited.
- **Sell removed from Lots & Batches** (selling lives in the Outbound flow);
  the sell API itself is untouched.
- **Camera-first receiving**: clicking "Receive Lot" opens the device camera
  immediately (where supported); the traced barcode is checked against the
  shipment and the manager's assigned warehouse, the lot details are shown,
  and only after a verified scan does the backend move stock. On receipt, the
  SOURCE warehouse's team and the admin are notified that the transfer was
  delivered (lots + quantities included).

## 12. Camera scanning fixed for desktop browsers (highest priority)
Root cause: the scanner depended on the browser-native BarcodeDetector API,
which exists on Chrome for Android/macOS but NOT on Windows desktop
Chrome/Edge — so the camera never offered itself there. CameraScanner now
layers decoders: native BarcodeDetector where present, otherwise the tiny
jsQR decoder loaded on demand from a CDN and cached (zero npm installs).
cameraScanSupported() now only requires getUserMedia, so the camera opens on
any modern browser at https:// or localhost. The dispatch manifest now also
renders as a proper QR code (new lib/qrcode.jsx, same on-demand pattern) next
to the existing Code-128 strip — QR is what a camera can actually read at a
90-character payload; the strip remains for keyboard-wedge scanners. Receive
Lot therefore now: opens the camera immediately → traces the manifest QR →
validates shipment + warehouse → shows the lot info → moves stock only after
the verified scan → notifies the source warehouse and admin.

## 13. Stock-verified request acceptance (auto-fulfilment)
Accepting a stock request now verifies the SOURCE warehouse actually holds
the requested quantity:
- Insufficient → 409 alert with exact availability ("only X of Y requested")
  and guidance (restock and accept later, or reject with a note); the request
  stays pending and nothing is created.
- Sufficient → the sending is performed automatically: lots are picked FEFO
  (earliest expiry first) and a planned transfer shipment source → requester
  is created and linked to the request. It flows through the normal
  approve/dispatch → in-transit → camera-scan receive lifecycle; when the
  destination verifies receipt, the request is auto-marked "fulfilled"
  ("Delivered & received" in the Requests tab). The requester and admin are
  notified of the acceptance including the shipment creation.
New regression suite tests/transferRequest.test.js covers the insufficient
alert, FEFO line picking, linkage, and source-only decision rights.

## 14. Dashboard KPIs fixed + admin Profit & Loss
- Fixed the common dashboard showing Stock Value ₹0 while Inventory Status
  showed ₹60,000: the reports/dashboard aggregates matched companyId/ownerId
  as a STRING, but Mongoose aggregate $match (unlike find) does not auto-cast
  to ObjectId, so they matched nothing. Now cast to ObjectId — Stock Value,
  Expiring value and Today's Sales populate correctly.
- The admin's profit/loss view already existed as the Executive dashboard
  (/ims/owner, executive:view — revenue, COGS, transport, gross profit, loss,
  margin, inventory valuation). Surfaced it on the common dashboard as an
  ADMIN-ONLY "Profit & Loss" card (Revenue · Cost · Gross Profit · Margin,
  with a loss callout) that links to the full Executive dashboard. Operations
  and sales managers never see company financials.

## 14b. Stock Value KPI — value from the product, not the zero inventory.costPrice
Inventory rows store costPrice 0 (cost lives on the Product), so the dashboard
Stock Value / Expiring aggregates read ₹0 while the Inventory Status panel
(valued at product MRP) showed a real figure. The aggregates now $lookup the
product and value each row by product cost price, falling back to product MRP
(then the inventory costPrice) — so the KPI reflects real data. Also confirmed
the companyId→ObjectId cast for aggregate $match.

## 15. Company lot-number PATTERN mode (auto-generate to an existing scheme)
Lot numbering now has three modes instead of two:
- company_defined — operator types each lot number (unchanged).
- company_pattern (NEW) — the company sets its own template (e.g.
  UR-{YYYY}-{MON}-{SEQ}) and Khetify auto-fills the running sequence, so
  companies keep their existing numbering scheme without typing each one.
  Tokens: {YYYY} {YY} {MM} {MON} {DD} {WH} {SEQ}/{SEQn}; a {SEQ} is appended
  automatically if missing, and the sequence is atomic per rendered prefix.
- khetify_generated — KH-<WH>-<YYYYMM>-<seq> (unchanged).
Settings shows the third option with a template input and a live preview;
the Receive Lot modal treats both auto modes as "leave blank to auto-assign".
Company.imsSettings.lotNumberFormat added (default {WH}-{YYYY}{MM}-{SEQ});
existing lot records are untouched. New test covers pattern generation.

## 15b. Fix: a company's CHOSEN lot number now integrates
The receive form keyed on Batch Number, so a manually chosen lot typed into
the Lot Number field was rejected/ignored. Now the chosen lot number is the
lot identity: in company_defined mode the operator's typed Lot Number is used
as-is (and becomes the batch identity if no separate batch is given); the form
requires a lot number (either field) instead of forcing Batch. Backend
receiveLot falls back batchNumber ← lotNumber before any auto-generation, so a
supplied number always wins. Lot tables, transfers, shipments and trace all
read this same lotNumber, so the chosen value flows through end to end.

## 16. Fix: declare runtime deps so a fresh npm install works
axios and @aws-sdk/* were used in code but not listed in package.json — they
only worked because the original archive shipped node_modules. Since the
package excludes node_modules, a fresh `npm install` missed them and the
backend crashed at startup ("Cannot find module 'axios'"). Added to
dependencies: axios, @aws-sdk/client-s3, @aws-sdk/client-lambda,
@aws-sdk/credential-providers. Run `npm install` in khetify-backend once.
