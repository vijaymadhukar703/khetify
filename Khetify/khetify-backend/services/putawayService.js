const PutawayTask = require("../model/Inventory/PutawayTask");
const GRN = require("../model/Inventory/GRN");
const Location = require("../model/Warehouse/Location");
const locationService = require("./locationService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function listTasks(companyId, { status = "pending", warehouseId } = {}) {
  const filter = { companyId };
  if (status) filter.status = status;
  if (warehouseId) filter.warehouseId = warehouseId;
  return PutawayTask.find(filter)
    .populate("productId", "productName skuNumber")
    .populate("suggestedLocationId", "fullCode")
    .populate("actualLocationId", "fullCode")
    .populate("inventoryId", "lotNumber batchNumber")
    .sort({ createdAt: 1 });
}

/**
 * Complete a putaway task: move its qty from the receiving pool into the
 * chosen bin (defaults to the suggested bin). Uses locationService.moveBinStock
 * so the InventoryBin row + bin_move ledger are written atomically. When the
 * parent GRN has no remaining open putaway tasks, the GRN is marked completed.
 */
async function completeTask(companyId, taskId, { locationId, performedBy } = {}) {
  const task = await PutawayTask.findOne({ _id: taskId, companyId });
  if (!task) throw httpErr("Putaway task not found", 404);
  if (task.status === "completed") throw httpErr("Task already completed", 409);

  const targetLocationId = locationId || task.suggestedLocationId;
  if (!targetLocationId) throw httpErr("A destination bin is required (no suggestion available)", 400);

  const bin = await Location.findOne({ _id: targetLocationId, companyId, type: "bin" });
  if (!bin) throw httpErr("Destination must be an existing bin", 404);

  // Move from the unbinned receiving pool into the bin (atomic + ledgered).
  await locationService.moveBinStock({
    companyId,
    fromLocationId: null,
    toLocationId: targetLocationId,
    inventoryId: task.inventoryId,
    qty: task.qty,
    performedBy,
  });

  task.status = "completed";
  task.actualLocationId = targetLocationId;
  task.assignedTo = performedBy;
  task.completedAt = new Date();
  await task.save();

  // Close the GRN once every putaway task is done.
  if (task.grnId) {
    const open = await PutawayTask.countDocuments({ grnId: task.grnId, status: { $in: ["pending", "in_progress"] } });
    if (open === 0) await GRN.updateOne({ _id: task.grnId, companyId }, { $set: { status: "completed" } });
  }

  return task;
}

module.exports = { listTasks, completeTask };
