const traceService = require("../../services/traceService");

const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });

/** GET /api/seller/trace/unit/:serial — the seller unit's journey. */
exports.unit = async (req, res) => {
  try {
    const data = await traceService.traceSellerSerial(req.user.sellerId, req.params.serial);
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/trace/lot/:lotNumber — the seller lot's stock + ledger. */
exports.lot = async (req, res) => {
  try {
    const data = await traceService.traceSellerLot(req.user.sellerId, req.params.lotNumber);
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};
