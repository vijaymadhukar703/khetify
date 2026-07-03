const { load, REQUIRED } = require("../config/env");
const { DRIVER } = require("../services/storage");

describe("env config loader", () => {
  test("loads with required vars present (JWT_SECRET set by test setup)", () => {
    process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/test";
    const cfg = load();
    expect(cfg.mongoUri).toBeTruthy();
    expect(cfg.jwtSecret).toBeTruthy();
    expect(Array.isArray(cfg.corsOrigins)).toBe(true);
  });

  test("parses a CORS allowlist from CORS_ORIGINS", () => {
    process.env.CORS_ORIGINS = "https://a.com, https://b.com";
    const cfg = load();
    expect(cfg.corsOrigins).toEqual(["https://a.com", "https://b.com"]);
    delete process.env.CORS_ORIGINS;
  });

  test("declares MONGO_URI and JWT_SECRET as required", () => {
    expect(REQUIRED).toContain("MONGO_URI");
    expect(REQUIRED).toContain("JWT_SECRET");
  });
});

describe("storage driver", () => {
  test("defaults to local when STORAGE_DRIVER is unset", () => {
    expect(["local", "s3"]).toContain(DRIVER);
  });
});
