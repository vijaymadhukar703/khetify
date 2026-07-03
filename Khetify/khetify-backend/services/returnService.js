const ReturnOrder = require("../model/Order/ReturnOrder");
const GRN = require("../model/Inventory/GRN");
const Warehouse = require("../model/Warehouse/Warehouse");
const { nextSeq } = require("./counterService");
const grnService = require("./grnService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function nextReturnNumber(companyId) {
  const now = new Date();
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const seq = await nextSeq(companyId, `ret-${period}`);
  return `RET-${period}-${String(seq).padStart(4, "0")}`;
}

async function createReturn(companyId, { orderId = null, customerId = null, warehouseId, lines = [], notes }) {
  const wh = await Warehouse.findOne({ _id: warehouseId, companyId });
  if (!wh) throw httpErr("Warehouse not found", 404);
  if (!lines.length) throw httpErr("At least one return line is required");

  const returnNumber = await nextReturnNumber(companyId);
  return ReturnOrder.create({ companyId, returnNumber, orderId, customerId, warehouseId, lines, notes, status: "draft" });
}

/**
 * Post a return: build a GRN of refType "Return" from the return lines and
 * post it. Resellable lines re-enter as sellable stock (acceptedQty);
 * damaged/expired lines land in damagedStock (rejectedQty). The GRN engine
 * handles lot creation, ledger and (for resellable qty) putaway tasks.
 */
async function postReturn(companyId, returnId, { performedBy } = {}) {
  const ret = await ReturnOrder.findOne({ _id: returnId, companyId });
  if (!ret) throw httpErr("Return not found", 404);
  if (ret.status === "completed") throw httpErr("Return already posted", 409);
  if (ret.status === "cancelled") throw httpErr("Return is cancelled", 409);

  const grnLines = ret.lines.map((l) => {
    const resellable = l.condition === "resellable";
    return {
      productId: l.productId,
      name: l.name,
      expectedQty: l.qty,
      receivedQty: l.qty,
      acceptedQty: resellable ? l.qty : 0,
      rejectedQty: resellable ? 0 : l.qty,
      rejectReason: resellable ? undefined : `Return: ${l.condition}${l.reason ? ` — ${l.reason}` : ""}`,
      lotNumber: l.lotNumber,
      batchNumber: l.batchNumber,
    };
  });

  const grnNumber = await grnService.nextGrnNumber(companyId);
  const grn = await GRN.create({
    companyId,
    grnNumber,
    refType: "Return",
    refId: ret._id,
    warehouseId: ret.warehouseId,
    lines: grnLines,
    status: "received",
    receivedBy: performedBy,
    notes: `Return ${ret.returnNumber}`,
  });

  await grnService.postGRN(companyId, grn._id, { performedBy });

  ret.grnId = grn._id;
  ret.status = "completed";
  await ret.save();
  return { ret, grnId: grn._id };
}

async function listReturns(companyId, { status } = {}) {
  const filter = { companyId };
  if (status) filter.status = status;
  return ReturnOrder.find(filter)
    .populate("lines.productId", "productName skuNumber")
    .populate("warehouseId", "name code")
    .sort({ createdAt: -1 });
}

module.exports = { createReturn, postReturn, listReturns };
