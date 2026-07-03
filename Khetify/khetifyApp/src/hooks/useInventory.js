import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import config from "../../config/config";
import { getSocket } from "../lib/socket";

/**
 * Loads the company's inventory and keeps it live via the
 * "inventory:updated" socket event (premium realtime; harmless if absent).
 */
export function useInventory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const token = localStorage.getItem("token");
  const authHeader = { headers: { Authorization: `Bearer ${token}` } };

  const fetchInventory = useCallback(async () => {
    try {
      const { data } = await axios.get(`${config.BASE_URL}inventory`, authHeader);
      if (data?.success) setItems(data.data);
    } catch (err) {
      console.error("Inventory fetch failed:", err?.response?.data || err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adjust = useCallback(
    async (productId, delta, channel = "online", note = "") => {
      const { data } = await axios.post(
        `${config.BASE_URL}inventory/adjust`,
        { productId, delta, channel, note },
        authHeader
      );
      await fetchInventory();
      return data;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchInventory]
  );

  useEffect(() => {
    fetchInventory();

    const socket = getSocket();
    if (!socket) return;
    const onUpdate = (payload) => {
      setItems((prev) =>
        prev.map((it) =>
          String(it.productId?._id || it.productId) === String(payload.productId)
            ? { ...it, availableStock: payload.availableStock, reservedStock: payload.reservedStock }
            : it
        )
      );
    };
    socket.on("inventory:updated", onUpdate);
    return () => socket.off("inventory:updated", onUpdate);
  }, [fetchInventory]);

  return { items, loading, refresh: fetchInventory, adjust };
}
