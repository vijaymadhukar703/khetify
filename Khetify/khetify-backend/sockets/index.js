const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

let io = null;

/**
 * Attach Socket.IO to the shared HTTP server.
 * Call once from Server.js: initSocket(httpServer)
 */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  // Auth handshake — client sends { auth: { token } }
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error("No token"));
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch (err) {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    // JWT payload is { id: companyId } for a company OWNER token.
    if (socket.user && socket.user.id) {
      socket.join(`company:${socket.user.id}`);
    }
    // Team-member tokens carry a distinct companyId (id === userId); join the
    // company room too so company-scoped events (notifications, chat) reach them.
    if (socket.user && socket.user.companyId) {
      socket.join(`company:${socket.user.companyId}`);
    }
    if (socket.user && socket.user.sellerId) {
      socket.join(`seller:${socket.user.sellerId}`);
    }
    // Platform admins share one room — the (single) super_admin sees every
    // company's chat activity live.
    if (socket.user && socket.user.principalType === "admin") {
      socket.join("admins");
    }
    console.log("🔌 socket connected:", socket.id);
  });

  console.log("⚡ Socket.IO initialized");
  return io;
}

function getIO() {
  return io;
}

/** Safe emit — no-op if sockets aren't initialized. */
function emitToCompany(companyId, event, payload) {
  if (io) io.to(`company:${companyId}`).emit(event, payload);
}

function emitToSeller(sellerId, event, payload) {
  if (io) io.to(`seller:${sellerId}`).emit(event, payload);
}

/** Broadcast to every connected platform admin (support inbox). */
function emitToAdmins(event, payload) {
  if (io) io.to("admins").emit(event, payload);
}

module.exports = { initSocket, getIO, emitToCompany, emitToSeller, emitToAdmins };
