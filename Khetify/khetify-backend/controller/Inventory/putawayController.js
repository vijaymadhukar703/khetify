const putawayService = require("../../services/putawayService");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("Putaway error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

exports.list = async (req, res) => {
  try {
    const rows = await putawayService.listTasks(req.user.companyId, req.query);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

exports.complete = async (req, res) => {
  try {
    const task = await putawayService.completeTask(req.user.companyId, req.params.id, {
      locationId: req.body.locationId,
      performedBy: req.user.id,
    });
    res.json({ success: true, message: "Putaway completed", data: task });
  } catch (err) { fail(res, err); }
};
