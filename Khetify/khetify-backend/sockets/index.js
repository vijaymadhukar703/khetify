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
    // JWT payload is { id: companyId } in this app.
    if (socket.user && socket.user.id) {
      socket.join(`company:${socket.user.id}`);
    }
    if (socket.user && socket.user.sellerId) {
      socket.join(`seller:${socket.user.sellerId}`);
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

module.exports = { initSocket, getIO, emitToCompany, emitToSeller };
