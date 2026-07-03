const AuditLog = require("../model/Audit/AuditLog");

/**
 * Write one audit row. Best-effort: a logging failure must never break the
 * business operation that triggered it, so errors are swallowed (and logged
 * to the console) rather than thrown.
 *
 * @param {object} p
 * @param {ObjectId} p.companyId   tenant scope (required)
 * @param {object}   [p.req]       express req — pulls actorId/actorRole/ip
 * @param {ObjectId} [p.actorId]   override actor (else from req.user)
 * @param {string}   [p.actorRole]
 * @param {string}   p.action      dotted action name, e.g. "user.role_changed"
 * @param {string}   [p.entityType]
 * @param {ObjectId} [p.entityId]
 * @param {*}        [p.before]
 * @param {*}        [p.after]
 * @param {string}   [p.note]
 * @param {object}   [p.session]   mongoose session to enlist in a txn
 */
async function log({
  companyId,
  req,
  actorId,
  actorRole,
  action,
  entityType,
  entityId,
  before,
  after,
  note,
  session,
} = {}) {
  try {
    const doc = {
      companyId: companyId || (req && req.user && req.user.companyId),
      actorId: actorId || (req && req.user && req.user.id),
      actorRole: actorRole || (req && req.user && req.user.role),
      action,
      entityType,
      entityId,
      before,
      after,
      note,
      ip: req ? req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress : undefined,
    };
    if (!doc.companyId || !doc.action) return null; // not enough to audit
    const opts = session ? { session } : {};
    const [row] = await AuditLog.create([doc], opts);
    return row;
  } catch (err) {
    console.error("auditService.log failed:", err.message);
    return null;
  }
}

module.exports = { log };
