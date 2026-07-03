// ─────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH FOR INVENTORY
// Both the Dashboard "Inventory status" widget and the Inventory tab
// import from here, so their numbers can never disagree.
//
// MVP note: this is seed/mock data. To go live, replace SEED_ITEMS with
// a fetch from GET /api/inventory and keep the same shape + helpers.
// ─────────────────────────────────────────────────────────────

// Each item carries a numeric `stock`, a `reorderLevel`, and a `price`
// so status, alerts, and stock value are all *computed*, never hardcoded.
export const SEED_ITEMS = [
  { id: 'PROD-9821', name: 'Hybrid Tomato Seeds V2', category: 'Seeds',       sellers: 12, stock: 4500, reorderLevel: 500, price: 120, sold: 2340 },
  { id: 'PROD-7742', name: 'Organic NPK Fertilizer',  category: 'Fertilizers', sellers: 8,  stock: 240,  reorderLevel: 300, price: 850, sold: 890  },
  { id: 'PROD-1290', name: 'Electric Power Sprayer',  category: 'Tools',       sellers: 5,  stock: 12,   reorderLevel: 50,  price: 3200, sold: 156 },
  { id: 'PROD-4431', name: 'Pest Control Liquid 1L',  category: 'Fertilizers', sellers: 15, stock: 8200, reorderLevel: 1000, price: 450, sold: 12100 },
  { id: 'PROD-5110', name: 'Zinc Sulphate Granules',  category: 'Fertilizers', sellers: 3,  stock: 1100, reorderLevel: 400, price: 600, sold: 4400 },
  { id: 'PROD-9900', name: 'Urea Fertilizer 50kg',    category: 'Fertilizers', sellers: 10, stock: 500,  reorderLevel: 200, price: 1100, sold: 1200 },
  { id: 'PROD-8800', name: 'Copper Sulphate',         category: 'Fertilizers', sellers: 4,  stock: 0,    reorderLevel: 100, price: 700, sold: 50   },
];

export const STATUS = {
  IN: 'In stock',
  LOW: 'Low stock',
  OUT: 'Out of stock',
};

/** Derive a status from quantity vs reorder level — used everywhere. */
export function statusOf(item) {
  if (item.stock <= 0) return STATUS.OUT;
  if (item.stock <= item.reorderLevel) return STATUS.LOW;
  return STATUS.IN;
}

/** Roll up a list of items into the numbers the dashboard widget shows. */
export function computeInventorySummary(items) {
  const total = items.length;
  let inStock = 0, lowStock = 0, outOfStock = 0, stockValue = 0;

  for (const item of items) {
    const s = statusOf(item);
    if (s === STATUS.IN) inStock++;
    else if (s === STATUS.LOW) lowStock++;
    else outOfStock++;
    stockValue += item.stock * item.price;
  }

  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  return {
    total,
    inStock,
    lowStock,
    outOfStock,
    stockValue,
    inStockPct: pct(inStock),
    lowStockPct: pct(lowStock),
    outOfStockPct: pct(outOfStock),
    unitsSold: items.reduce((sum, i) => sum + (i.sold || 0), 0),
    totalSellers: items.reduce((sum, i) => sum + (i.sellers || 0), 0),
  };
}

/** ₹ formatter used across the IMS. */
export function formatINR(n) {
  return '₹' + Number(n).toLocaleString('en-IN');
}
