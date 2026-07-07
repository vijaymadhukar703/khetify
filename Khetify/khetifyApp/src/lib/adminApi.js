// ─────────────────────────────────────────────────────────────
// Admin API layer — the platform admin panel talks to /api/admin
// through here. Mirrors lib/imsApi.js (axios + config.BASE_URL) but
// uses its OWN token key ("adminToken") so it never collides with a
// company/seller session in the same browser.
// ─────────────────────────────────────────────────────────────
import axios from "axios";
import config from "../../config/config";

const api = axios.create({ baseURL: config.BASE_URL });

export const ADMIN_TOKEN_KEY = "adminToken";
export const ADMIN_KEY = "adminUser";

api.interceptors.request.use((req) => {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

const data = (p) => p.then((r) => r.data);

/* ---- auth ---- */
export const adminLogin = (body) => data(api.post("admin/login", body));
export const getAdminMe = () => data(api.get("admin/me"));

/* ---- dashboard ---- */
export const getAdminDashboard = () => data(api.get("admin/dashboard"));

/* ---- companies ---- */
// params: { status: all|pending|approved|rejected, search }
export const getAdminCompanies = (params = {}) => data(api.get("admin/companies", { params }));
export const getAdminCompany = (id) => data(api.get(`admin/companies/${id}`));
export const setAdminCompanyStatus = (id, status) => data(api.patch(`admin/companies/${id}/status`, { status }));

/* ---- support chats (live company↔admin chat) ---- */
// status: all | AI | WAITING_AGENT | AGENT | CLOSED
export const getAdminChats = (status) =>
  data(api.get("admin/chats", { params: status && status !== "all" ? { status } : {} }));
export const getAdminChatMessages = (id) => data(api.get(`admin/chats/${id}/messages`));
export const takeAdminChat = (id) => data(api.post(`admin/chats/${id}/take`));
export const replyAdminChat = (id, message) => data(api.post(`admin/chats/${id}/reply`, { message }));
export const closeAdminChat = (id) => data(api.post(`admin/chats/${id}/close`));

/* ---- session helpers ---- */
export const isAdminAuthed = () => !!localStorage.getItem(ADMIN_TOKEN_KEY);
export const saveAdminSession = (token, admin) => {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
  if (admin) localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
};
export const getAdminUser = () => {
  try { return JSON.parse(localStorage.getItem(ADMIN_KEY) || "null"); } catch { return null; }
};
export const clearAdminSession = () => {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_KEY);
};
