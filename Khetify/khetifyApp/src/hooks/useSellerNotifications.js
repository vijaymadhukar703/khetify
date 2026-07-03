import { useEffect, useState, useCallback } from 'react';
import {
  getSellerNotifications, markSellerNotificationRead, markAllSellerNotificationsRead,
} from '../lib/sellerApi';
import { getSellerSocket } from '../lib/socket';

/**
 * Seller notification state — mirrors the company `useNotifications`, but reads
 * /api/seller/notifications and listens on the SELLER socket room. Kept live via
 * the "notification:new" event the backend emits to the seller on every
 * seller-scoped event (request accepted, dispatched, arrived, received, …).
 */
export function useSellerNotifications() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(() => {
    getSellerNotifications()
      .then((r) => { if (r?.success) { setItems(r.data); setUnread(r.unread); } })
      .catch(() => {});
  }, []);

  const markRead = useCallback(async (id) => {
    await markSellerNotificationRead(id).catch(() => {});
    refresh();
  }, [refresh]);

  const markAll = useCallback(async () => {
    await markAllSellerNotificationsRead().catch(() => {});
    refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    const socket = getSellerSocket();
    if (!socket) return undefined;
    const onNew = (doc) => { setItems((prev) => [doc, ...prev]); setUnread((u) => u + 1); };
    socket.on('notification:new', onNew);
    return () => socket.off('notification:new', onNew);
  }, [refresh]);

  return { items, unread, refresh, markRead, markAll };
}

/**
 * Where a seller notification should take the user when clicked. Driven by the
 * payload `kind` the backend sets, with a type-based fallback. Covers every
 * seller notification kind so the bell + Home feed always direct to the right
 * functionality. Returns null only for the truly unknown (the caller falls back
 * to the seller Home).
 */
export function sellerNotifRoute(n) {
  const kind = n?.payload?.kind || '';
  if (kind.startsWith('pc_')) return '/seller/certifications';
  if (kind.startsWith('supply_')) return '/seller/supply';
  if (kind.startsWith('seller_link')) return '/seller/companies';
  if (kind.startsWith('transfer_')) return '/seller/operations?tab=shipments';
  if (n?.type === 'pc_status') return '/seller/certifications';
  if (n?.type === 'supply_status') return '/seller/supply';
  if (n?.type === 'shipment') return '/seller/operations?tab=shipments';
  if (n?.type === 'order') return '/seller/outbound';
  if (n?.type === 'low_stock' || n?.type === 'expiry') return '/seller/inventory';
  return null;
}
