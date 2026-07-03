import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications, NOTIF_ICON } from '../../hooks/useNotifications';

/** Header bell: unread badge + a dropdown of recent alerts. */
const NotificationBell = () => {
  const navigate = useNavigate();
  const { items, unread, markRead, markAll, scan } = useNotifications();
  const [open, setOpen] = useState(false);

  // Generate fresh expiry / low-stock alerts once when the shell mounts.
  useEffect(() => { scan(); }, [scan]);

  const recent = items.slice(0, 6);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-stone-400 hover:text-stone-600 relative p-1 transition-colors"
        title="Notifications"
      >
        <span className="material-symbols-outlined text-[24px]">notifications</span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-[#EA2831] text-white text-[9px] font-bold rounded-full flex items-center justify-center border border-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-3 w-80 bg-white border border-stone-200 rounded-2xl shadow-xl z-40 overflow-hidden font-sora">
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
              <p className="font-bold text-stone-900 text-sm">Notifications</p>
              {unread > 0 && (
                <button onClick={markAll} className="text-[11px] font-bold text-[#EA2831] hover:underline">
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {recent.length === 0 && (
                <p className="text-sm text-stone-400 text-center py-8">You're all caught up 🎉</p>
              )}
              {recent.map((n) => {
                const meta = NOTIF_ICON[n.type] || { icon: 'notifications', cls: 'text-stone-500 bg-stone-100' };
                return (
                  <button
                    key={n._id}
                    onClick={() => {
                      if (!n.read) markRead(n._id);
                      // Incoming-transfer alerts land on the Hub, where the
                      // "Transfers needing you" panel lets the user act in place.
                      if (n.payload?.kind === 'transfer_incoming') {
                        setOpen(false);
                        navigate('/hub');
                      }
                    }}
                    className={`w-full text-left flex gap-3 px-4 py-3 border-b border-stone-50 hover:bg-stone-50 transition-colors ${n.read ? '' : 'bg-red-50/30'}`}
                  >
                    <span className={`material-symbols-outlined text-base h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${meta.cls}`}>{meta.icon}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-stone-900 truncate">{n.title}</p>
                      <p className="text-[11px] text-stone-500 leading-snug">{n.body}</p>
                    </div>
                    {!n.read && <span className="ml-auto mt-1 h-2 w-2 rounded-full bg-[#EA2831] shrink-0" />}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => { setOpen(false); navigate('/notifications'); }}
              className="w-full text-center text-[11px] font-bold text-stone-500 hover:text-stone-900 py-3 border-t border-stone-100 uppercase tracking-wider"
            >
              View all
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default NotificationBell;
