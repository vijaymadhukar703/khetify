import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  getAdminChats,
  getAdminChatMessages,
  takeAdminChat,
  replyAdminChat,
  closeAdminChat,
} from '../../lib/adminApi';
import { getAdminSocket } from '../../lib/socket';

const fmtTime = (d) =>
  d ? new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
const fmtWhen = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  const today = new Date();
  const sameDay = dt.toDateString() === today.toDateString();
  return sameDay
    ? dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : dt.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
};

// Filter tabs + status pill styling (OPEN is a legacy alias for AI).
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'AI', label: 'AI' },
  { key: 'WAITING_AGENT', label: 'Waiting Agent' },
  { key: 'AGENT', label: 'Agent' },
  { key: 'CLOSED', label: 'Closed' },
];
const STATUS_META = {
  AI: { label: 'AI', cls: 'bg-violet-50 text-violet-700 border-violet-100' },
  OPEN: { label: 'AI', cls: 'bg-violet-50 text-violet-700 border-violet-100' },
  WAITING_AGENT: { label: 'Waiting', cls: 'bg-amber-50 text-amber-700 border-amber-100' },
  AGENT: { label: 'Agent', cls: 'bg-green-50 text-green-700 border-green-100' },
  CLOSED: { label: 'Closed', cls: 'bg-stone-100 text-stone-500 border-stone-200' },
};
const statusMeta = (s) => STATUS_META[s] || STATUS_META.AI;

const AdminSupportChats = () => {
  const [filter, setFilter] = useState('all');
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [taking, setTaking] = useState(false);

  const bottomRef = useRef(null);
  const activeIdRef = useRef(activeId);
  const filterRef = useRef(filter);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { filterRef.current = filter; }, [filter]);

  const scrollToBottom = () =>
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));

  const loadChats = useCallback(async (f = filterRef.current) => {
    try {
      const res = await getAdminChats(f);
      setChats(res?.data || []);
    } catch {
      setChats([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const openThread = useCallback(async (id) => {
    setActiveId(id);
    setLoadingThread(true);
    try {
      const res = await getAdminChatMessages(id);
      setMessages(res?.data || []);
      scrollToBottom();
    } catch {
      setMessages([]);
    } finally {
      setLoadingThread(false);
    }
  }, []);

  // Reload the inbox whenever the filter changes.
  useEffect(() => { setLoadingList(true); loadChats(filter); }, [filter, loadChats]);

  // Realtime: new messages, status changes + inbox re-sorts via the "admins" room.
  useEffect(() => {
    const socket = getAdminSocket();
    if (!socket) return;
    const onMessage = (payload) => {
      const msg = payload?.message;
      if (msg && payload.conversationId === activeIdRef.current) {
        setMessages((prev) => (prev.some((m) => m._id === msg._id) ? prev : [...prev, msg]));
        scrollToBottom();
      }
    };
    const onUpdated = () => loadChats();
    socket.on('chat:message', onMessage);
    socket.on('chat:updated', onUpdated);
    socket.on('chat:status', onUpdated);
    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:updated', onUpdated);
      socket.off('chat:status', onUpdated);
    };
  }, [loadChats]);

  const active = chats.find((c) => c._id === activeId) || null;
  const closed = active?.status === 'CLOSED';
  // "Take Chat" is offered while the bot owns it (AI) or it's queued (WAITING).
  const canTake = active && ['AI', 'OPEN', 'WAITING_AGENT'].includes(active.status);

  const handleTake = async () => {
    if (!activeId || taking) return;
    setTaking(true);
    try {
      await takeAdminChat(activeId);
      await loadChats();
      openThread(activeId);
    } catch {
      /* ignore — a socket event will still refresh the list */
    } finally {
      setTaking(false);
    }
  };

  const handleReply = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending || !activeId) return;
    setSending(true);
    try {
      const res = await replyAdminChat(activeId, text);
      if (res?.data) {
        setMessages((prev) => (prev.some((m) => m._id === res.data._id) ? prev : [...prev, res.data]));
      }
      setInput('');
      scrollToBottom();
      loadChats();
    } catch {
      /* keep the text so the admin can retry */
    } finally {
      setSending(false);
    }
  };

  const handleClose = async () => {
    if (!activeId) return;
    try {
      await closeAdminChat(activeId);
      loadChats();
      openThread(activeId);
    } catch {
      /* ignore — list will still refresh on next event */
    }
  };

  return (
    <div className="h-full flex flex-col p-4 sm:p-6 font-sora bg-stone-50">
      <div className="mb-4">
        <h3 className="text-2xl font-bold text-stone-900">Support Chats</h3>
        <p className="text-stone-500 text-sm mt-1">Live conversations with companies. AI handles common questions; take over anytime.</p>
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => { setActiveId(null); setFilter(f.key); }}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-full border transition-colors ${
              filter === f.key
                ? 'bg-[#EA2831] text-white border-[#EA2831]'
                : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4">
        {/* ── Inbox list ── */}
        <div className={`${activeId ? 'hidden md:flex' : 'flex'} flex-col bg-white border border-stone-200 rounded-2xl overflow-hidden`}>
          <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
            <span className="text-sm font-bold text-stone-700">Conversations</span>
            <span className="text-[11px] font-bold text-stone-400 bg-stone-50 px-2 py-0.5 rounded-full">{chats.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-stone-100">
            {loadingList ? (
              <p className="text-center text-xs text-stone-400 py-8">Loading…</p>
            ) : chats.length === 0 ? (
              <p className="text-center text-xs text-stone-400 py-8">No conversations in this view.</p>
            ) : (
              chats.map((c) => (
                <button
                  key={c._id}
                  onClick={() => openThread(c._id)}
                  className={`w-full text-left px-4 py-3 hover:bg-stone-50 transition-colors ${activeId === c._id ? 'bg-red-50/60' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-stone-900 truncate">{c.companyName}</span>
                    <span className="text-[10px] text-stone-400 shrink-0">{fmtWhen(c.lastMessageAt || c.updatedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-stone-500 truncate">{c.lastMessage || 'No messages yet'}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border uppercase tracking-wide shrink-0 ${statusMeta(c.status).cls}`}>
                      {statusMeta(c.status).label}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ── Thread ── */}
        <div className={`${activeId ? 'flex' : 'hidden md:flex'} flex-col bg-white border border-stone-200 rounded-2xl overflow-hidden`}>
          {!active ? (
            <div className="flex-1 flex flex-col items-center justify-center text-stone-400">
              <span className="material-symbols-outlined text-5xl text-stone-300">forum</span>
              <p className="text-sm mt-2">Select a conversation to view messages.</p>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button onClick={() => setActiveId(null)} className="md:hidden text-stone-500 hover:text-stone-800">
                    <span className="material-symbols-outlined">arrow_back</span>
                  </button>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-stone-900 truncate">{active.companyName}</p>
                    <span className={`inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border uppercase tracking-wide ${statusMeta(active.status).cls}`}>
                      {statusMeta(active.status).label}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canTake && (
                    <button
                      onClick={handleTake}
                      disabled={taking}
                      className="text-xs font-bold text-white bg-[#EA2831] px-3 py-1.5 rounded-lg hover:bg-[#c91e26] transition-colors disabled:opacity-60"
                    >
                      {taking ? 'Taking…' : 'Take Chat'}
                    </button>
                  )}
                  {!closed && (
                    <button
                      onClick={handleClose}
                      className="text-xs font-bold text-stone-600 border border-stone-300 px-3 py-1.5 rounded-lg hover:bg-stone-50 transition-colors"
                    >
                      Close
                    </button>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-stone-50">
                {loadingThread ? (
                  <p className="text-center text-xs text-stone-400 mt-6">Loading messages…</p>
                ) : messages.length === 0 ? (
                  <p className="text-center text-xs text-stone-400 mt-6">No messages yet.</p>
                ) : (
                  messages.map((m) => {
                    if (m.senderType === 'system') {
                      return (
                        <div key={m._id} className="flex justify-center">
                          <span className="text-[11px] text-stone-500 bg-stone-200/70 px-3 py-1 rounded-full">{m.message}</span>
                        </div>
                      );
                    }
                    const mine = m.senderType === 'admin';
                    const isBot = m.senderType === 'bot';
                    return (
                      <div key={m._id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-[75%]">
                          {!mine && (
                            <span className="text-[10px] font-bold text-stone-400 ml-1 mb-0.5 block">
                              {isBot ? 'AI Assistant' : 'Company'}
                            </span>
                          )}
                          <div className={`px-3.5 py-2 rounded-2xl text-sm leading-relaxed ${
                            mine
                              ? 'bg-[#EA2831] text-white rounded-br-sm'
                              : isBot
                                ? 'bg-violet-50 text-stone-800 border border-violet-100 rounded-bl-sm'
                                : 'bg-white text-stone-800 border border-stone-200 rounded-bl-sm'
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

              {/* Composer */}
              <form onSubmit={handleReply} className="px-3 py-3 border-t border-stone-100 bg-white flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={closed ? 'Reply to reopen the conversation…' : 'Type your reply…'}
                  className="flex-1 h-11 px-4 text-sm border border-stone-300 rounded-full outline-none focus:ring-2 focus:ring-[#EA2831]"
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  aria-label="Send reply"
                  className="flex items-center justify-center w-11 h-11 rounded-full bg-[#EA2831] text-white hover:bg-[#c91e26] transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined text-[20px]">send</span>
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminSupportChats;
