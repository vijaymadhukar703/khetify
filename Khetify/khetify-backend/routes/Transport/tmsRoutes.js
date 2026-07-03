const express = require("express");

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const upload = require("../../middlewares/upload");
const v = require("../../validators/transportValidators");
const ctrl = require("../../controller/Transport/tmsController");
const trCtrl = require("../../controller/Transport/transferRequestController");

/* /api/vehicles */
const vehicles = express.Router();
vehicles.get("/", auth, authorize("vehicle:read"), ctrl.listVehicles);
vehicles.post("/", auth, authorize("vehicle:manage"), validate({ body: v.createVehicleBody }), ctrl.createVehicle);
vehicles.patch("/:id", auth, authorize("vehicle:manage"), ctrl.updateVehicle);

/* /api/drivers */
const drivers = express.Router();
drivers.get("/", auth, authorize("driver:read"), ctrl.listDrivers);
drivers.post("/", auth, authorize("driver:manage"), validate({ body: v.createDriverBody }), ctrl.createDriver);
drivers.patch("/:id", auth, authorize("driver:manage"), ctrl.updateDriver);

/* /api/shipments (manager) */
const shipments = express.Router();
shipments.get("/", auth, authorize("shipment:read"), ctrl.listShipments);
shipments.get("/discrepancies", auth, authorize("shipment:read"), ctrl.discrepancies);
shipments.get("/:id", auth, authorize("shipment:read"), ctrl.getShipment);
shipments.post("/", auth, authorize("shipment:create"), validate({ body: v.createShipmentBody }), ctrl.createShipment);
shipments.post("/:id/approve", auth, authorize("shipment:dispatch"), ctrl.approve);
shipments.post("/:id/dispatch", auth, authorize("shipment:dispatch"), validate({ body: v.dispatchBody }), ctrl.dispatch);
shipments.post("/:id/verify", auth, authorize("shipment:receive"), validate({ body: v.verifyBody }), ctrl.verifyReceipt);
shipments.post("/:id/deliver", auth, authorize("shipment:dispatch"), validate({ body: v.deliverBody }), ctrl.deliver);
shipments.post("/:id/exception", auth, authorize("shipment:receive"), validate({ body: v.exceptionBody }), ctrl.exception);

/* /api/driver (mobile) */
const driver = express.Router();
driver.post("/login", validate({ body: v.driverLoginBody }), ctrl.driverLogin);
driver.get("/shipments", auth, authorize("shipment:read_own"), ctrl.myShipments);
driver.post("/shipments/:id/arrived", auth, authorize("shipment:update_own"), validate({ body: v.arrivedBody }), ctrl.driverArrived);
driver.post("/shipments/:id/pod", auth, authorize("pod:upload"), upload.array("photos", 5), ctrl.driverDeliver);
driver.post("/shipments/:id/exception", auth, authorize("shipment:update_own"), validate({ body: v.exceptionBody }), ctrl.driverException);

/* /api/transfer-requests — inter-warehouse stock requests (B asks A) */
const transferRequests = express.Router();
transferRequests.get("/", auth, authorize("shipment:read"), trCtrl.list);
transferRequests.post("/", auth, authorize("shipment:create"), trCtrl.create);
transferRequests.post("/:id/accept", auth, authorize("shipment:dispatch"), trCtrl.accept);
transferRequests.post("/:id/reject", auth, authorize("shipment:dispatch"), trCtrl.reject);

module.exports = { vehicles, drivers, shipments, driver, transferRequests };
