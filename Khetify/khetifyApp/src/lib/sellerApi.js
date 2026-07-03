// ─────────────────────────────────────────────────────────────
// SELLER API layer — every seller-portal page calls the backend through here.
// Mirrors lib/imsApi.js, but uses a DISTINCT storage key ("sellerToken") so a
// seller session and a company session can coexist without colliding.
// ─────────────────────────────────────────────────────────────
import axios from "axios";
import config from "../../config/config";

const SELLER_TOKEN_KEY = "sellerToken";

export const getSellerToken = () => localStorage.getItem(SELLER_TOKEN_KEY);
export const setSellerToken = (t) => localStorage.setItem(SELLER_TOKEN_KEY, t);
export const clearSellerToken = () => localStorage.removeItem(SELLER_TOKEN_KEY);
export const isSellerAuthed = () => !!getSellerToken();

const api = axios.create({ baseURL: `${config.BASE_URL}seller/` });

api.interceptors.request.use((req) => {
  const token = getSellerToken();
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

const data = (p) => p.then((r) => r.data);

/* ---- auth ---- */
export const registerSeller = (body) => data(api.post("register", body));
export const loginSeller = (body) => data(api.post("login", body));
export const getSellerMe = () => data(api.get("me"));
// Registration profile (identity + GSTIN/PAN + KYC docs as signed URLs),
// resolved from the seller token — mirrors the company /company/profile.
export const getSellerProfile = () => data(api.get("profile"));
// Edit own profile — multipart (identity/compliance fields + replacement docs).
export const updateSellerProfile = (formData) => data(api.patch("profile", formData));

/* ---- onboarding wizard ---- */
export const saveSellerInfo = (body) => data(api.put("onboarding/info", body));
export const saveSellerContact = (body) => data(api.put("onboarding/contact", body));
export const saveSellerVerification = (body) => data(api.put("onboarding/verification", body));
export const submitSellerOnboarding = () => data(api.post("onboarding/submit", {}));

/* ---- companies (derived from PC issuance) ---- */
// The seller's companies with their PC status (active = certificate issued, or an
// in-progress / rejected application). `status=active` narrows to issued PCs.
export const getSellerCompanies = (status) => data(api.get("companies", { params: status ? { status } : {} }));
// Approved companies the seller isn't engaged with yet — candidates to apply to for a PC.
export const searchSellerCompanies = (q = "") => data(api.get("companies/search", { params: { q } }));
// Recommended companies to apply to — IMS-subscribed companies ranked first.
export const getRecommendedCompanies = () => data(api.get("companies/recommended"));

/* ---- team / roles (seller RBAC) ---- */
export const SELLER_TEAM_ROLES = [
  { value: "seller_admin", label: "Admin (full access)" },
  { value: "seller_manager", label: "Manager (operate, no team/billing)" },
  { value: "seller_staff", label: "Staff (read-mostly)" },
];
export const getSellerTeam = () => data(api.get("team"));
export const createSellerMember = (body) => data(api.post("team", body));
export const updateSellerMember = (id, body) => data(api.patch(`team/${id}`, body));
export const deleteSellerMember = (id) => data(api.delete(`team/${id}`));

/* ---- authorization status (read-only; now PC-derived) ---- */
export const getSellerLink = () => data(api.get("link"));
export const ackSellerApproval = () => data(api.post("ack-approval"));

/* ---- Principal Certificate: documents ---- */
export const getSellerDocuments = () => data(api.get("documents"));
export const uploadSellerDocuments = (formData) => data(api.post("documents", formData));
export const deleteSellerDocument = (id) => data(api.delete(`documents/${id}`));

/* ---- Principal Certificate: applications + agreement ---- */
// The company's PC application form + profile autofill + the profile-prereq state.
export const getPcApplyForm = (companyId) => data(api.get(`pc-applications/form/${companyId}`));
export const getPcApplications = () => data(api.get("pc-applications"));
export const getPcApplication = (id) => data(api.get(`pc-applications/${id}`));
export const createPcApplication = (body) => data(api.post("pc-applications", body));
export const attachPcDocuments = (id, documentIds) => data(api.post(`pc-applications/${id}/documents`, { documentIds }));
export const getPcAgreement = (id) => data(api.get(`pc-applications/${id}/agreement`));
export const signPcAgreement = (id, body) => data(api.post(`pc-applications/${id}/agreement/sign`, body)); // {signedName,consent} OR FormData

/* ---- Principal Certificate: issued certificates + govt ---- */
export const getSellerCertificates = () => data(api.get("certificates"));
export const getSellerCertificate = (id) => data(api.get(`certificates/${id}`));
export const downloadSellerCertificate = (id) => data(api.get(`certificates/${id}/download`));

/* ---- seller notifications (same system as company, scoped to the seller) ---- */
export const getSellerNotifications = () => data(api.get("notifications"));
export const markSellerNotificationRead = (id) => data(api.put(`notifications/${id}/read`));
export const markAllSellerNotificationsRead = () => data(api.put("notifications/read-all"));

/* ---- seller-owned warehouses (Phase 2b) ---- */
export const getSellerWarehouses = () => data(api.get("warehouses"));
export const getSellerWarehouseStockSummary = (id) => data(api.get(`warehouses/${id}/stock-summary`));
export const createSellerWarehouse = (body) => data(api.post("warehouses", body));
export const updateSellerWarehouse = (id, body) => data(api.put(`warehouses/${id}`, body));
export const deactivateSellerWarehouse = (id) => data(api.patch(`warehouses/${id}/deactivate`));

/* ---- read-only catalog of the linked company's products (Phase 2c) ---- */
export const getSellerProducts = (params = {}) => data(api.get("products", { params }));
export const getSellerProduct = (id) => data(api.get(`products/${id}`));

/* ---- marketplace listings (publish a company's product to the customer
   storefront — reads/writes the `sellerlistings` collection; publish is gated
   server-side by requireActivePC(companyId) + certification:manage) ---- */
export const getMyListings = () => data(api.get("listings"));
export const publishListing = ({ companyId, productId, price }) =>
  data(api.post("listings/publish", { companyId, productId, price }));
export const unpublishListing = (listingId) =>
  data(api.patch(`listings/${listingId}/unpublish`));

/* ---- inbound supply requests (Phase 3) ---- */
export const createSellerSupplyOrder = (body) => data(api.post("supply-orders", body));
export const getSellerSupplyOrders = () => data(api.get("supply-orders"));
export const receiveSellerSupply = (id, body) => data(api.post(`supply-orders/${id}/receive`, body));

/* ---- read-only inventory / lots (Phase 4a) ---- */
export const getSellerLots = (params = {}) => data(api.get("lots", { params }));

/* ---- inter-warehouse transfers (request → accept → shipment lifecycle) ---- */
export const getSellerTransfers = (params = {}) => data(api.get("transfers", { params }));
// Request a transfer A→B: { fromWarehouseId, toWarehouseId, productId, qty, note }
export const createSellerTransfer = (body) => data(api.post("transfers", body));
export const acceptSellerTransfer = (id, body = {}) => data(api.post(`transfers/${id}/accept`, body));
// Products the seller HOLDS in a warehouse (in-stock lots, grouped) — fills the
// transfer Product picker. Pass { forRequest: 1 } to read ANOTHER of your
// warehouses' stock (the holder you're pulling from), bypassing manager scope.
export const getSellerTransferStock = (warehouseId, opts = {}) => data(api.get('transfers/stock', { params: { warehouseId, ...opts } }));
// ALL warehouses owned by the seller ACCOUNT (not manager-scoped) — for the transfer DESTINATION picker.
export const getSellerTransferWarehouses = () => data(api.get('transfers/warehouses'));
export const rejectSellerTransfer = (id, body = {}) => data(api.post(`transfers/${id}/reject`, body));

/* ---- shipments (supply + transfers): dispatch + scan-receive ---- */
export const getSellerShipments = (params = {}) => data(api.get("shipments", { params }));
export const getSellerShipment = (id) => data(api.get(`shipments/${id}`));
// Send Stock pipeline: scan-to-pick → pack → (label) → dispatch, like the company.
export const pickSellerShipment = (id, body) => data(api.post(`shipments/${id}/pick`, body));
export const packSellerShipment = (id, body = {}) => data(api.post(`shipments/${id}/pack`, body));
// Build/print the shipping label (QR) BEFORE dispatch.
export const getSellerShipmentManifest = (id) => data(api.get(`shipments/${id}/manifest`));
// Dispatch needs { labelPrinted: true } (+ optional transport) — gated like the company.
export const dispatchSellerShipment = (id, body = {}) => data(api.post(`shipments/${id}/dispatch`, body));
export const receiveSellerShipment = (id, body) => data(api.post(`shipments/${id}/receive`, body));

/* ---- traceability (owner-aware) ---- */
export const sellerTraceUnit = (serial) => data(api.get(`trace/unit/${encodeURIComponent(serial)}`));
export const sellerTraceLot = (lotNumber) => data(api.get(`trace/lot/${encodeURIComponent(lotNumber)}`));

/* ---- analytics / dashboard (owner + warehouse-scoped) ---- */
export const getSellerDashboardSummary = () => data(api.get("reports/dashboard"));
export const getSellerReportList = () => data(api.get("reports"));
export const runSellerReport = (name, params = {}) => data(api.get(`reports/${name}`, { params }));
export const downloadSellerReportCsv = async (name, params = {}) => {
  const res = await api.get(`reports/${name}`, { params: { ...params, format: "csv" }, responseType: "blob" });
  const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${name}.csv`; document.body.appendChild(a); a.click(); a.remove();
  window.URL.revokeObjectURL(url);
};

/* ---- unit labels: view / (re)print / scan / history (Phase 4b) ---- */
export const getSellerUnits = (params = {}) => data(api.get("units", { params }));
export const printSellerUnits = (serials) => data(api.post("units/print", { serials }));
export const sellerScan = (code) => data(api.post("scan", { code }));
export const sellerUnitHistory = (serial) => data(api.get(`units/${serial}/history`));

/* ---- customers & dealers (Phase 5a) ---- */
export const getSellerCustomers = (params = {}) => data(api.get("customers", { params }));
export const createSellerCustomer = (body) => data(api.post("customers", body));
export const updateSellerCustomer = (id, body) => data(api.put(`customers/${id}`, body));
export const getSellerCustomerHistory = (id) => data(api.get(`customers/${id}/history`));

/* ---- outbound sales / orders (Phase 5b) ---- */
export const getSellerOrders = (params = {}) => data(api.get("orders", { params }));
export const getSellerOrder = (id) => data(api.get(`orders/${id}`));
export const getSellerOrderPicklist = (id) => data(api.get(`orders/${id}/picklist`));
export const createSellerOrder = (body) => data(api.post("orders", body));
export const updateSellerOrderStatus = (id, status) => data(api.patch(`orders/${id}/status`, { status }));

/* ---- subscription / billing ---- */
export const getSellerSubscription = () => data(api.get("subscription/me"));
export const getSellerPlans = () => data(api.get("subscription/plans"));
export const changeSellerPlan = (plan) => data(api.post("subscription/change", { plan }));

// Seller feature keys (mirror config/plans.js). Tag premium SELLER_MODULES with these.
export const SELLER_FEATURES = {
  INVENTORY_VIEW: "inventory_view",
  UNIT_LABELS: "unit_labels",
  MULTI_WAREHOUSE: "multi_warehouse",
  ADVANCED_ANALYTICS: "advanced_analytics",
};

/* ---- RBAC stub (Phase 1): seller_admin holds everything within its scope.
   Real gating (capabilities / subscription) is wired in later phases. ---- */
export const sellerCan = () => true;
