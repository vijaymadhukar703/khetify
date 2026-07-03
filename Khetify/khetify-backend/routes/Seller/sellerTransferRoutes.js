const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const requireApprovedSeller = require("../../middlewares/requireApprovedSeller");
const authorize = require("../../middlewares/authorize");
const { listTransfers, createTransfer, acceptTransfer, rejectTransfer, warehouseStock, accountWarehouses } = require("../../controller/Seller/sellerTransferController");

// Seller inter-warehouse transfer REQUESTS (request → accept → shipment).
// Approved sellers only; reads need transfer:read, write actions need
// transfer:create (seller_admin "*" and seller_manager "transfer:*" hold both;
// seller_staff is read-only). Dispatch + scan-receive live on /seller/shipments.
router.use(auth, requireApprovedSeller);
router.get("/", authorize("transfer:read"), listTransfers);
router.get("/warehouses", authorize("transfer:read"), accountWarehouses); // ALL seller-account warehouses (destination picker)
router.get("/stock", authorize("transfer:read"), warehouseStock); // products held in a warehouse (for the picker)
router.post("/", authorize("transfer:create"), createTransfer);
router.post("/:id/accept", authorize("transfer:create"), acceptTransfer);
router.post("/:id/reject", authorize("transfer:create"), rejectTransfer);

module.exports = router;
