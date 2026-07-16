// ─────────────────────────────────────────────────────────────
// IMS API layer — every IMS page calls the backend through here.
// Follows the same pattern as hooks/useInventory.js:
// BASE_URL from config + Bearer token from localStorage.
// ─────────────────────────────────────────────────────────────
import axios from "axios";
import config from "../../config/config";

const api = axios.create({ baseURL: config.BASE_URL });

api.interceptors.request.use((req) => {
  const token = localStorage.getItem("token");
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

const data = (p) => p.then((r) => r.data);

/* ---- lots & batches (NEW backend: /api/lots) ---- */
export const getLots = (params = {}) => data(api.get("lots", { params }));
export const receiveLot = (body) => data(api.post("lots/receive", body));
export const transferLot = (body) => data(api.post("lots/transfer", body));
export const sellFefo = (body) => data(api.post("lots/sell-fefo", body));

/* ---- existing inventory endpoints ---- */
export const getInventory = (params = {}) => data(api.get("inventory", { params }));
export const getMovements = (productId) => data(api.get(`inventory/${productId}/movements`));

/* ---- downstream sellers — the company's PC-issued (authorized) resellers ---- */
export const getCompanySellers = () => data(api.get("company/sellers"));

/* ---- Principal Certificate (company side) ---- */
// The company-configurable PC application form (builder).
export const getCompanyPcForm = () => data(api.get("company/pc-form"));
export const saveCompanyPcForm = (fields) => data(api.put("company/pc-form", { fields }));
export const getCompanyPcApplications = (status) => data(api.get("company/pc-applications", { params: status ? { status } : {} }));
export const getCompanyPcApplication = (id) => data(api.get(`company/pc-applications/${id}`));
export const reviewPcApplication = (id) => data(api.post(`company/pc-applications/${id}/review`));
export const requestPcDocs = (id, body) => data(api.post(`company/pc-applications/${id}/request-docs`, body));
export const rejectPcApplication = (id, reason) => data(api.post(`company/pc-applications/${id}/reject`, { reason }));
export const approvePcApplication = (id) => data(api.post(`company/pc-applications/${id}/approve`));
export const attachPcAgreement = (id, formData) => data(api.post(`company/pc-applications/${id}/agreement/attach`, formData));
export const issuePc = (id, body) => data(api.post(`company/pc-applications/${id}/issue-pc`, body));
export const getCompanyCertificates = (status) => data(api.get("company/certificates", { params: status ? { status } : {} }));
export const revokeCertificate = (id, reason) => data(api.post(`company/certificates/${id}/revoke`, { reason }));
export const reinstateCertificate = (id) => data(api.post(`company/certificates/${id}/reinstate`));
export const verifySellerDocument = (id, note) => data(api.post(`company/seller-documents/${id}/verify`, { note }));
export const rejectSellerDocument = (id, note) => data(api.post(`company/seller-documents/${id}/reject`, { note }));

/* ---- inbound supply requests from sellers (company side, Phase 3) ---- */
// `params.stage` (pick|pack|dispatch) narrows to a Send Stock tab.
export const getSupplyOrders = (params = {}) => data(api.get("supply-order", { params }));
export const getSupplyPendingCount = () => data(api.get("supply-order/pending-count"));
// Per-warehouse availability for the order's items (drives "Assign a source warehouse").
export const getSupplySourceOptions = (id) => data(api.get(`supply-order/${id}/source-options`));
// READ-ONLY detail for one request: summary + parent lots + the exact child
// serials picked. Fetched only when opening View Details.
export const getSupplyOrderDetails = (id) => data(api.get(`supply-order/${id}/details`));
export const updateSupplyStatus = (id, body) => data(api.put(`supply-order/${id}/status`, body));
// Direct pick/pack/dispatch on the supply order (no PickList/wave).
export const pickSupplyOrder = (id, body) => data(api.post(`supply-order/${id}/pick`, body));
export const packSupplyOrder = (id, body = {}) => data(api.post(`supply-order/${id}/pack`, body));
// Ensure a planned shipment + manifest token for the label barcode (idempotent).
export const getSupplyManifest = (id) => data(api.get(`supply-order/${id}/manifest`));
export const dispatchSupplyOrder = (id, body) => data(api.post(`supply-order/${id}/dispatch`, body));

/* ---- warehouses (existing backend) ---- */
export const getWarehouses = () => data(api.get("warehouse"));
// Full company warehouse directory (names only) — for transfer/shipment
// DESTINATION pickers; unaffected by the caller's warehouse scope.
export const getWarehouseDirectory = () => data(api.get("warehouse", { params: { directory: 1 } }));
export const createWarehouse = (body) => data(api.post("warehouse", body));
export const updateWarehouse = (id, body) => data(api.put(`warehouse/${id}`, body));

/* ---- storage locations / bins (NEW backend: /api/locations) ---- */
export const getLocations = (params = {}) => data(api.get("locations", { params }));
export const getLocationBins = (params = {}) => data(api.get("locations/bins", { params }));
export const createLocation = (body) => data(api.post("locations", body));
export const generateLocations = (body) => data(api.post("locations/generate", body));
export const moveBinStock = (body) => data(api.post("locations/move", body));

/* ---- transport (legacy backend: /api/transport) ---- */
export const getShipments = (params = {}) => data(api.get("transport", { params }));
export const createShipment = (body) => data(api.post("transport", body));
export const updateShipmentStatus = (id, status) =>
  data(api.patch(`transport/${id}/status`, { status }));

/* ---- TMS: vehicles / drivers / shipments (NEW backend) ---- */
export const getVehicles = () => data(api.get("vehicles"));
export const createVehicle = (body) => data(api.post("vehicles", body));
export const getDrivers = () => data(api.get("drivers"));
export const createDriver = (body) => data(api.post("drivers", body));
export const getTmsShipments = (params = {}) => data(api.get("shipments", { params }));
export const getTmsShipment = (id) => data(api.get(`shipments/${id}`));
export const createTmsShipment = (body) => data(api.post("shipments", body));
/* ---- inter-warehouse stock requests (B asks A; A accepts/rejects) ---- */
export const getTransferRequests = (params = {}) => data(api.get("transfer-requests", { params }));
export const createTransferRequest = (body) => data(api.post("transfer-requests", body));
export const acceptTransferRequest = (id, body = {}) => data(api.post(`transfer-requests/${id}/accept`, body));
export const rejectTransferRequest = (id, body = {}) => data(api.post(`transfer-requests/${id}/reject`, body));

export const approveShipment = (id) => data(api.post(`shipments/${id}/approve`));
export const dispatchShipment = (id, body = {}) => data(api.post(`shipments/${id}/dispatch`, body));
export const verifyShipment = (id, body) => data(api.post(`shipments/${id}/verify`, body));
// Inventory → Receive Lot: resolve an EXACT parent lot number to the incoming
// transfer awaiting this warehouse. Read-only; confirm via verifyShipment.
export const getIncomingTransferByLot = (lot) => data(api.get("shipments/incoming", { params: { lot } }));
// Company Warehouse Receive Lot: an EXACT parent lot booked to this warehouse
// but awaiting its receipt (inTransitStock). Read-only.
export const getIncomingLot = (lot) => data(api.get("lots/incoming", { params: { lot } }));
// The ONLY call that turns that pending qty into this warehouse's stock.
export const confirmLotReceipt = (id) => data(api.post(`lots/${id}/confirm-receipt`));
export const deliverShipment = (id, body) => data(api.post(`shipments/${id}/deliver`, body));
export const shipmentException = (id, body) => data(api.post(`shipments/${id}/exception`, body));
export const getDiscrepancies = (params = {}) => data(api.get("shipments/discrepancies", { params }));

/* ---- driver mobile (NEW backend: /api/driver) ---- */
export const driverLogin = (body) => data(api.post("driver/login", body));
export const driverShipments = () => data(api.get("driver/shipments"));
export const driverArrived = (id, body) => data(api.post(`driver/shipments/${id}/arrived`, body));
export const driverPod = (id, body) => data(api.post(`driver/shipments/${id}/pod`, body));
export const driverException = (id, body) => data(api.post(`driver/shipments/${id}/exception`, body));

/* ---- products (existing backend, for the Receive Lot dropdown) ---- */
export const getProducts = () => data(api.get("product/all"));

/* ---- customers + traceability (NEW backend: /api/customers, /api/trace) ---- */
export const getCustomers = (params = {}) => data(api.get("customers", { params }));
export const getCustomer = (id) => data(api.get(`customers/${id}`));
export const getCustomerHistory = (id) => data(api.get(`customers/${id}/history`));
export const createCustomer = (body) => data(api.post("customers", body));
export const updateCustomer = (id, body) => data(api.patch(`customers/${id}`, body));
export const traceSerial = (serial) => data(api.get(`trace/serial/${serial}`));
export const traceLot = (lot) => data(api.get(`trace/lot/${lot}`));
export const traceInvoice = (inv) => data(api.get(`trace/invoice/${inv}`));

/* ---- outbound: pick / pack / dispatch (NEW backend) ---- */
export const generateWave = (body) => data(api.post("picklists/generate", body));
export const getPickLists = (params = {}) => data(api.get("picklists", { params }));
export const getPickList = (id) => data(api.get(`picklists/${id}`));
export const pickLine = (id, body) => data(api.post(`picklists/${id}/pick`, body));
// Direct order pick (no wave): { picks: [{ productId, serials?, qty?, binCode? }] }
export const pickOrder = (id, body) => data(api.post(`picklists/order/${id}/pick`, body));
export const getPackages = (params = {}) => data(api.get("packages", { params }));
export const createPackage = (body) => data(api.post("packages", body));
export const dispatchOrder = (body) => data(api.post("dispatch", body));

/* ---- orders (NEW backend: /api/orders) ---- */
export const createOrder = (body) => data(api.post("orders", body));
export const getOrders = (params = {}) => data(api.get("orders", { params }));
export const getOrderSummary = (params = {}) => data(api.get("orders/summary", { params }));
export const getOrderHistory = (params = {}) => data(api.get("orders/history", { params }));
// Read-only traceability for one transfer/shipment: summary + parent lots + the
// exact child serials it moved. Warehouse-scoped server-side.
export const getShipmentDetails = (id) => data(api.get(`shipments/${id}/details`));
export const getOrder = (id) => data(api.get(`orders/${id}`));
export const getOrderPicklist = (id) => data(api.get(`orders/${id}/picklist`));
export const updateOrderStatus = (id, status) => data(api.patch(`orders/${id}/status`, { status }));

/* ---- analytics (NEW backend: /api/analytics) ---- */
export const getAnalytics = () => data(api.get("analytics/overview"));

/* ---- reports (NEW backend: /api/reports) ---- */
export const getReportList = () => data(api.get("reports"));
export const getDashboardSummary = (params = {}) => data(api.get("reports/dashboard", { params }));
export const runReport = (name, params = {}) => data(api.get(`reports/${name}`, { params }));
export const downloadReportCsv = async (name, params = {}) => {
  const res = await api.get(`reports/${name}`, { params: { ...params, format: "csv" }, responseType: "blob" });
  const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${name}.csv`; document.body.appendChild(a); a.click(); a.remove();
  window.URL.revokeObjectURL(url);
};

/* ---- company profile (existing backend: /api/company) ---- */
export const getCompany = (id) => data(api.get(`company/${id}`));
// Own registration profile (identity + GSTIN/PAN + KYC docs as signed URLs),
// resolved from the token — no id needed (fixes the "No company id" path).
export const getCompanyProfile = () => data(api.get("company/profile"));
// Edit own profile — multipart (identity/compliance fields + replacement docs).
export const updateCompanyProfile = (formData) => data(api.patch("company/profile", formData));
export const updateCompany = (id, body) => data(api.put(`company/update/${id}`, body));

/* ---- support tickets (NEW backend: /api/support) ---- */
export const getSupportTickets = () => data(api.get("support/tickets"));
export const createSupportTicket = (body) => data(api.post("support/tickets", body));

/* ---- company IMS settings (NEW backend: /api/company/settings/ims) ---- */
export const getImsSettings = () => data(api.get("company/settings/ims"));
export const updateImsSettings = (body) => data(api.put("company/settings/ims", body));

/* ---- inbound: GRN / putaway (NEW backend: /api/grn, /api/putaway) ---- */
export const getGRNs = (params = {}) => data(api.get("grn", { params }));
export const getGRN = (id) => data(api.get(`grn/${id}`));
export const createGRN = (body) => data(api.post("grn", body));
export const receiveGRN = (id, body) => data(api.patch(`grn/${id}/receive`, body));
export const postGRN = (id) => data(api.post(`grn/${id}/post`));
export const writeoffDamaged = (body) => data(api.post("grn/writeoff", body));
export const getPutawayTasks = (params = {}) => data(api.get("putaway", { params }));
export const completePutaway = (id, body) => data(api.post(`putaway/${id}/complete`, body));

/* ---- adjustments (NEW backend: /api/adjustments) ---- */
export const getAdjustments = (params = {}) => data(api.get("adjustments", { params }));
export const createAdjustment = (body) => data(api.post("adjustments", body));
export const approveAdjustment = (id) => data(api.post(`adjustments/${id}/approve`));
export const rejectAdjustment = (id) => data(api.post(`adjustments/${id}/reject`));

/* ---- cycle counts / audits (NEW backend: /api/cycle-counts) ---- */
export const getCycleCounts = (params = {}) => data(api.get("cycle-counts", { params }));
export const getCycleCount = (id) => data(api.get(`cycle-counts/${id}`));
export const generateCount = (body) => data(api.post("cycle-counts/generate", body));
export const submitCount = (id, body) => data(api.patch(`cycle-counts/${id}/submit`, body));
export const completeCount = (id) => data(api.post(`cycle-counts/${id}/complete`));
export const cancelCount = (id) => data(api.post(`cycle-counts/${id}/cancel`));

/* ---- returns (NEW backend: /api/returns) ---- */
export const getReturns = (params = {}) => data(api.get("returns", { params }));
export const createReturn = (body) => data(api.post("returns", body));
export const postReturn = (id) => data(api.post(`returns/${id}/post`));

/* ---- unit barcodes / scan / recall (NEW backend: /api/units,/scan,/recall) ---- */
export const getUnits = (params = {}) => data(api.get("units", { params }));
export const generateUnits = (body) => data(api.post("units/generate", body));
export const markUnitsPrinted = (serials) => data(api.post("units/print", { serials }));
export const getUnitHistory = (serial) => data(api.get(`units/history/${serial}`));
export const scanCode = (code) => data(api.post("scan", { code }));
export const recallLot = (lotNumber) => data(api.post("recall", { lotNumber }));

/* ---- integrations (NEW backend: /api/integrations) ---- */
export const getApiKeys = () => data(api.get("integrations/keys"));
export const createApiKey = (body) => data(api.post("integrations/keys", body));
export const revokeApiKey = (id) => data(api.delete(`integrations/keys/${id}`));
export const getWebhooks = () => data(api.get("integrations/webhooks"));
export const createWebhook = (body) => data(api.post("integrations/webhooks", body));
export const updateWebhook = (id, body) => data(api.patch(`integrations/webhooks/${id}`, body));
export const deleteWebhook = (id) => data(api.delete(`integrations/webhooks/${id}`));
export const testWebhook = (id) => data(api.post(`integrations/webhooks/${id}/test`));
export const getChannels = () => data(api.get("integrations/channels"));
export const connectChannel = (body) => data(api.post("integrations/channels", body));

/* ---- enterprise: owner KPIs, costing, reconciliation (NEW backend) ---- */
export const getOwnerDashboard = (params = {}) => data(api.get("owner/dashboard", { params }));
export const getProductCosts = () => data(api.get("costing"));
export const requestCostChange = (productId, body) => data(api.post(`costing/${productId}/request`, body));
export const approveCostChange = (productId, approve) => data(api.post(`costing/${productId}/approve`, { approve }));
export const getProfitability = (params = {}) => data(api.get("costing/profitability", { params }));
export const upsertShipmentCost = (shipmentId, body) => data(api.put(`transport-costs/${shipmentId}`, body));
export const getTransportCostSummary = (params = {}) => data(api.get("transport-costs/analytics/summary", { params }));
export const runReconcile = () => data(api.post("audit/reconcile"));

/* ---- auth identity + capabilities (NEW backend: /api/auth/me) ---- */
export const getMe = () => data(api.get("auth/me"));

/* ---- team / users (NEW backend: /api/users) ---- */
export const getUsers = () => data(api.get("users"));
export const createUser = (body) => data(api.post("users", body));
export const updateUser = (id, body) => data(api.patch(`users/${id}`, body));
export const deleteUser = (id) => data(api.delete(`users/${id}`));

/* ---- purchasing (NEW backend: /api/purchasing) ---- */
export const getVendors = () => data(api.get("purchasing/vendors"));
export const createVendor = (body) => data(api.post("purchasing/vendors", body));
export const getPurchaseOrders = () => data(api.get("purchasing/purchase-orders"));
export const createPurchaseOrder = (body) => data(api.post("purchasing/purchase-orders", body));
export const updatePurchaseOrderStatus = (id, status) =>
  data(api.patch(`purchasing/purchase-orders/${id}/status`, { status }));

/* ---- billing history (existing backend: /api/subscription) ---- */
export const getBillingHistory = () => data(api.get("subscription/payments"));

/* ---- notifications (existing backend: /api/notifications) ---- */
export const getNotifications = () => data(api.get("notifications"));
export const markNotificationRead = (id) => data(api.put(`notifications/${id}/read`));
export const markAllNotificationsRead = () => data(api.put("notifications/read-all"));
export const scanAlerts = () => data(api.post("notifications/scan"));

/* ---- shared display helpers ---- */
export const formatINR = (n) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export const daysToExpiry = (d) =>
  d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null;

export const expiryBadge = (d) => {
  const days = daysToExpiry(d);
  if (days === null) return { label: "No expiry", cls: "bg-stone-100 text-stone-500" };
  if (days < 0) return { label: "Expired", cls: "bg-red-50 text-red-600" };
  if (days <= 90) return { label: `${days}d left`, cls: "bg-orange-50 text-orange-600" };
  return { label: "Good", cls: "bg-green-50 text-green-600" };
};

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
