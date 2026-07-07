import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  startConversation,
  startNewConversation,
  getMyConversation,
  getChatMessages,
  sendChatMessage,
} from '../../lib/chatApi';
import { getSocket } from '../../lib/socket';

// Floating company↔support chat. Lives in DashboardLayout so it's reachable from
// every company screen. Realtime via the shared company socket ("chat:message"
// / "chat:closed"); falls back to the REST calls for history + sending.

const fmtTime = (d) =>
  d ? new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';

// Conversation status → what the company sees in the widget header.
const STATUS_LABEL = {
  AI: 'AI Assistant',
  OPEN: 'AI Assistant', // legacy Phase-1 threads
  WAITING_AGENT: 'Waiting for Admin',
  AGENT: 'Connected with Agent',
  CLOSED: 'Closed',
};
const statusLabel = (s) => STATUS_LABEL[s] || 'AI Assistant';

const SupportChatWidget = () => {
  const [open, setOpen] = useState(false);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [startingNew, setStartingNew] = useState(false);
  const [unread, setUnread] = useState(0);

  const bottomRef = useRef(null);
  const openRef = useRef(open);
  const convoRef = useRef(conversation);
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => { convoRef.current = conversation; }, [conversation]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
  };

  // Append a message from the socket, de-duping against optimistic/echoed ids.
  const pushMessage = useCallback((msg) => {
    setMessages((prev) => {
      if (msg?._id && prev.some((m) => m._id === msg._id)) return prev;
      return [...prev, msg];
    });
  }, []);

  // Live updates for this company (socket only carries THIS company's events).
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onMessage = (payload) => {
      const msg = payload?.message;
      if (!msg) return;
      // Adopt the conversation id if the widget hasn't started one yet.
      if (!convoRef.current && payload.conversationId) {
        setConversation({ _id: payload.conversationId, status: 'AI' });
      } else if (convoRef.current && payload.conversationId !== convoRef.current._id) {
        // Event belongs to a different (older/closed) thread — ignore so a new
        // chat never shows stale messages.
        return;
      }
      pushMessage(msg);
      if (openRef.current) scrollToBottom();
      else if (msg.senderType !== 'company') setUnread((u) => u + 1);
    };
    // Live status changes: AI → WAITING_AGENT → AGENT → CLOSED.
    const onStatus = (payload) => {
      if (convoRef.current && payload.conversationId !== convoRef.current._id) return;
      setConversation((c) => (c ? { ...c, status: payload.status } : c));
    };
    // Auto/manual close — payload carries the reason (INACTIVITY_TIMEOUT | MANUAL).
    const onClosed = (payload) => {
      if (convoRef.current && payload?.conversationId && payload.conversationId !== convoRef.current._id) return;
      setConversation((c) => (c ? { ...c, status: 'CLOSED', closeReason: payload?.reason || c.closeReason } : c));
    };
    socket.on('chat:message', onMessage);
    socket.on('chat:status', onStatus);
    socket.on('chat:closed', onClosed);
    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:status', onStatus);
      socket.off('chat:closed', onClosed);
    };
  }, [pushMessage]);

  // On first open: ensure a conversation exists + load its history.
  const openChat = async () => {
    setOpen(true);
    setUnread(0);
    if (conversation) { scrollToBottom(); return; }
    setLoading(true);
    try {
      const existing = await getMyConversation();
      const convo = existing?.data || (await startConversation()).data;
      setConversation(convo);
      const hist = await getChatMessages(convo._id);
      setMessages(hist?.data || []);
      scrollToBottom();
    } catch {
      /* leave the panel open with an empty thread; the user can retry sending */
    } finally {
      setLoading(false);
    }
  };

  // Start a fresh OPEN conversation (previous CLOSED thread is kept as history).
  const startNewChat = async () => {
    if (startingNew) return;
    setStartingNew(true);
    try {
      const res = await startNewConversation();
      const convo = res?.data;
      if (convo) {
        setConversation(convo);
        setMessages([]);
        setInput('');
        scrollToBottom();
      }
    } catch {
      /* ignore — the button stays so the user can retry */
    } finally {
      setStartingNew(false);
    }
  };

  // Send any text through the normal pipeline. Returns true on success so the
  // caller can decide whether to clear the input.
  const sendText = async (raw) => {
    const text = String(raw || '').trim();
    // A CLOSED conversation cannot accept messages — the UI shows "Start New
    // Chat" instead, but guard here too in case of a race.
    if (!text || sending || conversation?.status === 'CLOSED') return false;
    setSending(true);
    try {
      let convo = conversation;
      if (!convo) { convo = (await startConversation()).data; setConversation(convo); }
      const res = await sendChatMessage(convo._id, text);
      if (res?.data) pushMessage(res.data); // socket echo is de-duped by _id
      scrollToBottom();
      return true;
    } catch {
      return false; // keep the caller's text so it can retry
    } finally {
      setSending(false);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (await sendText(input)) setInput('');
  };

  // "Talk to Admin" — sends the escalation phrase so the backend hands the chat
  // to a human (WAITING_AGENT). Reuses the normal message pipeline.
  const talkToAdmin = () => sendText('Talk to Admin');

  const closed = conversation?.status === 'CLOSED';
  const inactivityClosed = closed && conversation?.closeReason === 'INACTIVITY_TIMEOUT';
  // Show the quick "Talk to Admin" action only while the bot still owns the chat.
  const aiStage = !conversation || ['AI', 'OPEN'].includes(conversation.status);

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <div className="fixed bottom-5 right-5 z-40 group">
          {/* Hover tooltip — sits to the LEFT of the icon (icon is bottom-right).
              hover-only, so hidden on touch/mobile where hover doesn't apply. */}
          <span
            role="tooltip"
            className="hidden sm:flex absolute right-full top-1/2 -translate-y-1/2 mr-3 items-center whitespace-nowrap px-3 py-1.5 rounded-lg bg-stone-900 text-white text-xs font-medium shadow-lg opacity-0 translate-x-1 pointer-events-none transition-all duration-150 group-hover:opacity-100 group-hover:translate-x-0"
          >
            Need help? Chat with support
          </span>
          <button
            onClick={openChat}
            aria-label="Open support chat"
            className="relative flex items-center justify-center w-14 h-14 rounded-full bg-[#EA2831] text-white shadow-lg hover:bg-[#c91e26] transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-[26px]">chat</span>
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 flex items-center justify-center text-[11px] font-bold bg-stone-900 text-white rounded-full border-2 border-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Chat popup */}
      {open && (
        <div className="fixed bottom-5 right-5 z-40 w-[calc(100vw-2.5rem)] sm:w-96 h-[70vh] sm:h-[520px] max-h-[calc(100vh-2.5rem)] flex flex-col bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden font-sora">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#EA2831] text-white">
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white/20">
                <span className="material-symbols-outlined text-[20px]">support_agent</span>
              </span>
              <div>
                <p className="text-sm font-bold leading-tight">Khetify Support</p>
                <p className="text-[11px] text-white/80 leading-tight flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${closed ? 'bg-white/50' : 'bg-green-300'}`} />
                  {inactivityClosed ? 'Closed · inactive' : statusLabel(conversation?.status)}
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Minimise chat"
              className="text-white/90 hover:text-white transition-colors"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-stone-50">
            {loading ? (
              <p className="text-center text-xs text-stone-400 mt-6">Loading conversation…</p>
            ) : messages.length === 0 ? (
              <div className="text-center text-stone-400 mt-10 px-4">
                <span className="material-symbols-outlined text-4xl text-stone-300">forum</span>
                <p className="text-sm mt-2">Start the conversation — tell us how we can help.</p>
              </div>
            ) : (
              messages.map((m) => {
                if (m.senderType === 'system') {
                  return (
                    <div key={m._id} className="flex justify-center">
                      <span className="text-[11px] text-stone-500 bg-stone-200/70 px-3 py-1 rounded-full">{m.message}</span>
                    </div>
                  );
                }
                const mine = m.senderType === 'company';
                const isBot = m.senderType === 'bot';
                return (
                  <div key={m._id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[80%]">
                      {!mine && (
                        <span className="text-[10px] font-bold text-stone-400 ml-1 mb-0.5 block">
                          {isBot ? 'AI Assistant' : 'Support Agent'}
                        </span>
                      )}
                      {/* Both incoming senders (AI bot + Support Agent) share ONE
                          bubble style — only the label above differs. */}
                      <div className={`px-3.5 py-2 rounded-2xl text-sm leading-relaxed ${
                        mine
                          ? 'bg-[#EA2831] text-white rounded-br-sm'
                          : 'bg-violet-50 text-stone-800 border border-violet-100 rounded-bl-sm'
                      }`}>
                        <p className="whitespace-pre-wrap break-words">{m.message}</p>
                        <p className={`text-[10px] mt-1 ${mine ? 'text-white/70' : 'text-stone-400'}`}>{fmtTime(m.createdAt)}</p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer — a CLOSED conversation shows a "Start New Chat" button
              instead of an input; a new OPEN thread is created on click. */}
          {closed ? (
            <div className="px-4 py-4 border-t border-stone-100 bg-white text-center">
              <p className="text-xs text-stone-500 mb-3">
                {inactivityClosed ? 'Conversation closed due to inactivity' : 'This conversation is closed.'}
              </p>
              <button
                onClick={startNewChat}
                disabled={startingNew}
                className="w-full py-3 bg-[#EA2831] text-white font-bold text-sm rounded-xl hover:bg-[#c91e26] transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[20px]">add_comment</span>
                {startingNew ? 'Starting…' : 'Start New Chat'}
              </button>
            </div>
          ) : (
            <>
            {/* Quick escalation — visible while the AI still owns the chat. */}
            {/* {aiStage && (
              <div className="px-3 pt-2 bg-white flex justify-center">
                <button
                  onClick={talkToAdmin}
                  disabled={sending}
                  className="text-[11px] font-bold text-[#EA2831] border border-red-100 bg-red-50/50 px-3 py-1.5 rounded-full hover:bg-red-50 transition-colors disabled:opacity-60 flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[15px]">support_agent</span>
                  Talk to Admin
                </button>
              </div>
            )} */}
            <form onSubmit={handleSend} className="px-3 py-3 border-t border-stone-100 bg-white flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type your message…"
                className="flex-1 h-11 px-4 text-sm border border-stone-300 rounded-full outline-none focus:ring-2 focus:ring-[#EA2831]"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                aria-label="Send message"
                className="flex items-center justify-center w-11 h-11 rounded-full bg-[#EA2831] text-white hover:bg-[#c91e26] transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[20px]">send</span>
              </button>
            </form>
            </>
          )}
        </div>
      )}
    </>
  );
};

export default SupportChatWidget;
