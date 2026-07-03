const Counter = require("../model/Counter");

/**
 * Atomically increment and return the next sequence number for a (company, key)
 * pair. Pass the active `session` when inside a transaction so the number is
 * allocated within the same atomic unit as the document that uses it.
 *
 * Returns a plain integer; callers format it (e.g. zero-pad) as needed.
 */
async function nextSeq(companyId, key, session) {
  const doc = await Counter.findOneAndUpdate(
    { companyId, key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session: session || undefined }
  );
  return doc.seq;
}

/**
 * Atomically reserve a CONTIGUOUS block of `count` sequence numbers and return
 * { start, end } (inclusive). Used for bulk serial generation so every unit
 * gets a unique number without N round-trips.
 */
async function nextSeqBlock(companyId, key, count, session) {
  const doc = await Counter.findOneAndUpdate(
    { companyId, key },
    { $inc: { seq: count } },
    { new: true, upsert: true, session: session || undefined }
  );
  return { start: doc.seq - count + 1, end: doc.seq };
}

module.exports = { nextSeq, nextSeqBlock };
