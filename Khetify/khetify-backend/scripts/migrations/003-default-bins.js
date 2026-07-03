/**
 * For every warehouse with no storage locations, create a default zone + bin
 * and put away each inventory row's on-hand stock into that bin (so the
 * pre-bin world becomes bin-tracked). Idempotent: warehouses that already have
 * locations are skipped, and stock already binned isn't moved again.
 *
 *   node scripts/migrations/003-default-bins.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Warehouse = require("../../model/Warehouse/Warehouse");
const Inventory = require("../../model/Inventory/Inventory");
const Location = require("../../model/Warehouse/Location");
const locationService = require("../../services/locationService");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const warehouses = await Warehouse.find({});
  let createdBins = 0, putAway = 0;

  for (const wh of warehouses) {
    const hasLocations = await Location.countDocuments({ companyId: wh.companyId, warehouseId: wh._id });
    if (hasLocations) continue;

    const zone = await locationService.createLocation(wh.companyId, { warehouseId: wh._id, type: "zone", code: "A" });
    const bin = await locationService.createLocation(wh.companyId, { warehouseId: wh._id, parentId: zone._id, type: "bin", code: "B01" });
    createdBins += 1;

    const rows = await Inventory.find({ ownerId: wh.companyId, ownerType: "company", warehouseId: wh._id, availableStock: { $gt: 0 } });
    for (const inv of rows) {
      const binned = await locationService.binnedQty(inv._id);
      const unbinned = (inv.onlineStock || 0) + (inv.offlineStock || 0) - binned;
      if (unbinned > 0) {
        await locationService.moveBinStock({ companyId: wh.companyId, toLocationId: bin._id, inventoryId: inv._id, qty: unbinned });
        putAway += 1;
      }
    }
  }
  console.log(`✅ Created ${createdBins} default bin(s); put away ${putAway} inventory row(s)`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
