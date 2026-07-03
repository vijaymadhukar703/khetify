/**
 * Spins up an in-memory MongoDB for the whole test run and connects mongoose
 * to it. Each test file gets a clean slate via clearing collections in
 * afterEach. A standalone in-memory server has NO transaction support, which
 * is exactly the path withTransaction() must degrade to gracefully.
 */
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
  await mongoose.connect(mongo.getUri());
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
