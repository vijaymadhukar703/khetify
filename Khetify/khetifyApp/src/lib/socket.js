import { io } from "socket.io-client";
import config from "../../config/config";

// Strip the trailing "/api/" to get the server origin (http://localhost:5000).
const SERVER_ORIGIN = config.BASE_URL.replace(/\/api\/?$/, "");

let socket = null;

/**
 * Get (or lazily create) the shared socket connection, authenticated with
 * the logged-in user's JWT. Safe to call from multiple components.
 */
export function getSocket() {
  const token = localStorage.getItem("token");
  if (!token) return null;

  if (!socket) {
    socket = io(SERVER_ORIGIN, {
      auth: { token },
      transports: ["websocket"],
      autoConnect: true,
    });
    socket.on("connect_error", (e) => console.warn("socket error:", e.message));
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// ── Seller socket ──────────────────────────────────────────────────────────
// A seller session uses a DISTINCT JWT ("sellerToken") and joins the
// `seller:<sellerId>` room on the backend. Kept separate from the company
// socket above so the two sessions never collide.
let sellerSocket = null;

export function getSellerSocket() {
  const token = localStorage.getItem("sellerToken");
  if (!token) return null;
  if (!sellerSocket) {
    sellerSocket = io(SERVER_ORIGIN, {
      auth: { token },
      transports: ["websocket"],
      autoConnect: true,
    });
    sellerSocket.on("connect_error", (e) => console.warn("seller socket error:", e.message));
  }
  return sellerSocket;
}

export function disconnectSellerSocket() {
  if (sellerSocket) {
    sellerSocket.disconnect();
    sellerSocket = null;
  }
}

// ── Admin socket ───────────────────────────────────────────────────────────
// The platform admin session uses its OWN JWT ("adminToken"). On the backend
// an admin token joins the shared "admins" room, so the support inbox updates
// live. Kept separate from the company/seller sockets above.
let adminSocket = null;

export function getAdminSocket() {
  const token = localStorage.getItem("adminToken");
  if (!token) return null;
  if (!adminSocket) {
    adminSocket = io(SERVER_ORIGIN, {
      auth: { token },
      transports: ["websocket"],
      autoConnect: true,
    });
    adminSocket.on("connect_error", (e) => console.warn("admin socket error:", e.message));
  }
  return adminSocket;
}

export function disconnectAdminSocket() {
  if (adminSocket) {
    adminSocket.disconnect();
    adminSocket = null;
  }
}
