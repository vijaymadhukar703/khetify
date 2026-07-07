// ─────────────────────────────────────────────────────────────
// Company support-chat API layer. Same pattern as lib/imsApi.js:
// axios + config.BASE_URL + the company Bearer token ("token").
// Talks to /api/chat/* (company-scoped on the backend via the JWT).
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

export const startConversation = () => data(api.post("chat/start"));
export const startNewConversation = () => data(api.post("chat/start-new"));
export const getMyConversation = () => data(api.get("chat/my-conversation"));
export const getChatMessages = (conversationId) => data(api.get(`chat/${conversationId}/messages`));
export const sendChatMessage = (conversationId, message) =>
  data(api.post(`chat/${conversationId}/message`, { message }));
