# Khetify — Project Context for Claude Code

## What this is
Multi-tenant inventory / warehouse / transport / sales platform for agri-product
companies in India. Tenants = Companies. Every record is scoped by companyId.

## Stack
- Backend: Node.js, Express 5, Mongoose 9 (MongoDB), Socket.io, JWT auth, Multer.
  Entry: khetify-backend/Server.js
- Frontend: React 18 + Vite + Tailwind. Entry: khetifyApp/src/App.jsx
- No TypeScript. Keep plain JS unless told otherwise.

## Layout conventions (follow exactly)
- Backend: model/<Domain>/X.js → services/<x>Service.js → controller/<Domain>/xController.js
  → routes/<Domain>/xRoutes.js → mounted in Server.js
- Business logic lives in services/, NOT controllers. Controllers only parse
  req, call service, shape the JSON response { success, message?, data, count? }.
- Frontend pages: khetifyApp/src/pages/Company/ims/*.jsx, shared UI in
  pages/Company/ims/ImsUi.jsx, API calls only via src/lib/imsApi.js,
  realtime via src/lib/socket.js, feature gating via Components/ims/FeatureGate.jsx.

## Non-negotiable invariants
1. EVERY stock change writes exactly one StockMovement row (append-only ledger).
   Never mutate or delete ledger rows.
2. availableStock = onlineStock + offlineStock - reservedStock. Recompute on write.
3. The unique index (productId, ownerType, ownerId, warehouseId, batchNumber)
   on Inventory must keep holding. New stock dimensions (bins) get their own
   collection rather than breaking this index — see InventoryBin design.
4. All multi-document writes (transfer, sale allocation, GRN posting) use
   MongoDB transactions (mongoose session). Assume replica set in production;
   wrap in withTransaction helper that no-ops sessions in dev if standalone.
5. Multi-tenancy: every query filters by companyId (or ownerId). Never trust
   IDs from the client without scoping.
6. Subscription gating: new premium features must be added to config/plans.js
   FEATURES and enforced with requireFeature middleware + FeatureGate on the UI.
7. Backwards compatibility: do not rename existing API routes or response
   shapes. Add new versions/fields instead. The mobile/web app in production
   depends on them.

## Testing & quality
- Add Jest + supertest. Every new service function gets unit tests; every new
  route gets at least one integration test (mongodb-memory-server).
- Run `npm test` and `npx eslint .` before declaring a task done.
- Seed data: extend scripts/seedIms.js when adding new entities.

## Security
- JWT must carry { id, companyId, role }. authorize() middleware enforces roles.
- Validate all input with a schema validator (zod or joi) at the route layer.
- Never log secrets. .env is git-ignored; add new vars to .env.example.

## Auth specifics (as implemented in Sprint 0)
- Company-owner tokens are signed as { id, companyId, role:"company_admin" }
  where id === companyId. Controllers historically use req.user.id AS the
  companyId — this must stay true for company-owner tokens. Prefer
  req.user.companyId in new code; authMiddleware guarantees it is set
  (falls back to decoded.id for legacy tokens).
- authorize() accepts BOTH legacy role names (e.g. "company_admin") and new
  capability strings containing a colon (e.g. "grn:post"). Capability strings
  are resolved through config/permissions.js. auditor is read-only everywhere.
- Wrap multi-doc writes in services/txn.js withTransaction(fn). It threads a
  mongoose session and no-ops gracefully on a standalone (dev) MongoDB.
- Log sensitive actions (role changes, shipment verification, adjustments,
  recalls) via services/auditService.log().
