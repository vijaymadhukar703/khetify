// ─────────────────────────────────────────────────────────────
// Customer storefront (/customer-shop) API layer.
// Public GETs need no token; the consumer Bearer token (localStorage
// "shopToken") is attached when present. Mirrors imsApi/sellerApi patterns.
// ─────────────────────────────────────────────────────────────
import axios from "axios";
import config from "../../config/config";

const SHOP_TOKEN_KEY = "shopToken";
export const getShopToken = () => localStorage.getItem(SHOP_TOKEN_KEY);
export const setShopToken = (t) => localStorage.setItem(SHOP_TOKEN_KEY, t);
export const clearShopToken = () => localStorage.removeItem(SHOP_TOKEN_KEY);

const api = axios.create({ baseURL: `${config.BASE_URL}shop/` });

api.interceptors.request.use((req) => {
  const token = getShopToken();
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

const data = (p) => p.then((r) => r.data);

/* ---- Public catalog (no login) ---- */
export const getShopProducts = (params = {}) => data(api.get("products", { params }));
export const getShopProduct = (listingId) => data(api.get(`products/${listingId}`));
export const getShopCategories = () => data(api.get("categories"));

/* ---- Consumer auth ---- */
export const shopRegister = (body) => data(api.post("auth/register", body));
export const shopLogin = (body) => data(api.post("auth/login", body));
export const shopVerifyOtp = (code) => data(api.post("auth/verify-otp", { code }));
export const shopResendOtp = () => data(api.post("auth/resend-otp"));
export const shopMe = () => data(api.get("auth/me"));

/* ---- Addresses ---- */
export const getShopAddresses = () => data(api.get("addresses"));
export const addShopAddress = (body) => data(api.post("addresses", body));
export const deleteShopAddress = (id) => data(api.delete(`addresses/${id}`));

/* ---- Checkout & orders ---- */
export const shopCheckout = (body) => data(api.post("checkout", body));
export const getShopOrders = () => data(api.get("orders"));
export const getShopOrder = (id) => data(api.get(`orders/${id}`));

export default api;
