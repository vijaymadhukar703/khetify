const mongoose = require("mongoose");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const Adjustment = require("../model/Inventory/Adjustment");
const svc = require("../services/adjustmentService");

const companyId = new mongoose.Types.ObjectId();
const requester = new mongoose.Types.ObjectId();
const approver = new mongoose.Types.ObjectId();

async function seedInv(qty) {
  return Inventory.create({
    productId: new mongoose.Types.ObjectId(),
    ownerType: "company",
    ownerId: companyId,
    batchNumber: "B1",
    lotNumber: "B1",
    offlineStock: qty,
    availableStock: qty,
  });
}

describe("adjustment approval flow", () => {
  test("approval applies the delta and writes an adjustment ledger row", async () => {
    const inv = await seedInv(100);
    const adj = await svc.createAdjustment(companyId, { inventoryId: inv._id, qtyDelta: -8, reason: "count_variance", requestedBy: requester });
    expect(adj.status).toBe("pending");

    // nothing applied yet
    let row = await Inventory.findById(inv._id);
    expect(row.availableStock).toBe(100);

    await svc.approveAdjustment(companyId, adj._id, { approverId: approver });

    row = await Inventory.findById(inv._id);
    expect(row.availableStock).toBe(92);
    expect(row.offlineStock).toBe(92);

    const ledger = await StockMovement.find({ inventoryId: inv._id, type: "adjustment" });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].quantity).toBe(-8);

    const done = await Adjustment.findById(adj._id);
    expect(done.status).toBe("approved");
    expect(String(done.approvedBy)).toBe(String(approver));
  });

  test("requester cannot approve their own adjustment", async () => {
    const inv = await seedInv(50);
    const adj = await svc.createAdjustment(companyId, { inventoryId: inv._id, qtyDelta: 5, reason: "data_entry", requestedBy: requester });
    await expect(svc.approveAdjustment(companyId, adj._id, { approverId: requester })).rejects.toMatchObject({ status: 403 });
    // stock untouched
    const row = await Inventory.findById(inv._id);
    expect(row.availableStock).toBe(50);
  });

  test("rejecting leaves stock unchanged", async () => {
    const inv = await seedInv(40);
    const adj = await svc.createAdjustment(companyId, { inventoryId: inv._id, qtyDelta: -10, reason: "theft", requestedBy: requester });
    await svc.rejectAdjustment(companyId, adj._id, { approverId: approver });
    const row = await Inventory.findById(inv._id);
    expect(row.availableStock).toBe(40);
    const ledger = await StockMovement.find({ inventoryId: inv._id, type: "adjustment" });
    expect(ledger).toHaveLength(0);
  });

  test("negative adjustment cannot drive stock below zero", async () => {
    const inv = await seedInv(5);
    const adj = await svc.createAdjustment(companyId, { inventoryId: inv._id, qtyDelta: -20, reason: "count_variance", requestedBy: requester });
    await expect(svc.approveAdjustment(companyId, adj._id, { approverId: approver })).rejects.toMatchObject({ status: 409 });
    const row = await Inventory.findById(inv._id);
    expect(row.availableStock).toBe(5);
  });
});
