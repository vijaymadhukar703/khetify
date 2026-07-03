const mongoose = require("mongoose");
const { withTransaction, supportsTransactions, _resetProbe } = require("../services/txn");

// A tiny throwaway model to exercise the helper.
const Thing = mongoose.model(
  "TxnTestThing",
  new mongoose.Schema({ name: String, n: Number })
);

describe("withTransaction()", () => {
  beforeEach(() => _resetProbe());

  test("standalone in-memory mongo reports no transaction support", () => {
    expect(supportsTransactions()).toBe(false);
  });

  test("runs fn with a null session and commits writes on standalone", async () => {
    const out = await withTransaction(async (session) => {
      expect(session).toBeNull(); // degraded path
      await Thing.create([{ name: "a", n: 1 }], session ? { session } : {});
      return "done";
    });
    expect(out).toBe("done");
    expect(await Thing.countDocuments()).toBe(1);
  });

  test("propagates errors thrown inside fn", async () => {
    await expect(
      withTransaction(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });

  test("returns the value fn returns", async () => {
    const v = await withTransaction(async () => 42);
    expect(v).toBe(42);
  });
});
