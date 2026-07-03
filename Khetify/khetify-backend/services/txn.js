const mongoose = require("mongoose");

/**
 * Run `fn(session)` inside a MongoDB transaction when the deployment supports
 * one (replica set / sharded), and WITHOUT a session when it does not
 * (a standalone mongod, typical in local dev) — in which case `fn(null)` runs
 * directly. Either way `fn` receives a value it can pass as `{ session }` to
 * every query (Mongoose ignores `session: null`).
 *
 * On transient transaction errors (TransientTransactionError /
 * write-conflict) the whole transaction is retried once.
 *
 * Usage:
 *   await withTransaction(async (session) => {
 *     await Inventory.findOneAndUpdate(filter, update, { session, new: true });
 *     await StockMovement.create([doc], { session });
 *   });
 *
 * IMPORTANT: when a session is active, EVERY read/write inside `fn` must pass
 * it, or those operations run outside the transaction.
 */
let _supportsTxn = null; // cache: null=unknown, true/false once probed

function supportsTransactions() {
  // Heuristic: transactions require a replica set or mongos. The driver exposes
  // the topology after connection. We fall back to "false" when uncertain.
  try {
    const admin = mongoose.connection;
    if (!admin || admin.readyState !== 1) return false;
    // Allow an explicit override for environments we can't probe.
    if (process.env.MONGO_TRANSACTIONS === "off") return false;
    if (process.env.MONGO_TRANSACTIONS === "on") return true;
    const desc = admin.client?.topology?.description;
    if (!desc) return false;
    const type = desc.type || "";
    // ReplicaSetWithPrimary, ReplicaSetNoPrimary, Sharded → support txns.
    return /ReplicaSet|Sharded/.test(type);
  } catch {
    return false;
  }
}

async function withTransaction(fn) {
  if (_supportsTxn === null) _supportsTxn = supportsTransactions();

  // Standalone / dev: just run it, no session.
  if (!_supportsTxn) {
    return fn(null);
  }

  let attempt = 0;
  // one retry on transient errors
  while (true) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result;
    } catch (err) {
      const transient =
        err?.errorLabels?.includes?.("TransientTransactionError") ||
        err?.errorLabels?.includes?.("UnknownTransactionCommitResult") ||
        err?.code === 112; // WriteConflict
      if (transient && attempt < 1) {
        attempt += 1;
        continue;
      }
      // If the server actually has no txn support, downgrade and retry once.
      const noTxnSupport =
        err?.code === 20 || // IllegalOperation: Transaction numbers...
        /Transaction numbers are only allowed|replica set|not supported/i.test(err?.message || "");
      if (noTxnSupport && attempt < 1) {
        _supportsTxn = false;
        attempt += 1;
        return fn(null);
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
}

/** Test/seed hook to reset the cached probe. */
function _resetProbe() {
  _supportsTxn = null;
}

module.exports = { withTransaction, supportsTransactions, _resetProbe };
