/**
 * Add Team Member — server-side mandatory-field validation.
 *
 * Every visible field (name, email, phone, role, temporary password) is required
 * on BOTH the company (`createUserBody`) and seller (`createSellerMemberBody`)
 * schemas, so the API rejects missing/empty values even if the form is bypassed.
 * Values are trimmed before checking, so whitespace-only counts as empty.
 */
const { createUserBody, createSellerMemberBody } = require("../validators/userValidators");

const VALID = {
  name: "Ravi Kumar",
  email: "ravi@example.com",
  phone: "9876543210",
  password: "secret123",
};

/** First zod issue message for a given field path. */
const errFor = (schema, body, field) => {
  const r = schema.safeParse(body);
  expect(r.success).toBe(false);
  const issue = r.error.issues.find((i) => i.path.join(".") === field);
  return issue?.message;
};

describe.each([
  ["company", () => createUserBody, "operations_manager"],
  ["seller", () => createSellerMemberBody, "seller_manager"],
])("%s Add Team Member schema", (_label, getSchema, role) => {
  const schema = getSchema();
  const valid = { ...VALID, role };

  test("accepts a fully-filled form and trims the values", () => {
    const r = schema.safeParse({ ...valid, name: "  Ravi Kumar  ", email: " ravi@example.com ", phone: " 9876543210 " });
    expect(r.success).toBe(true);
    expect(r.data.name).toBe("Ravi Kumar"); // trimmed
    expect(r.data.email).toBe("ravi@example.com");
    expect(r.data.phone).toBe("9876543210");
  });

  test.each([
    ["name", "Name is required"],
    ["email", "Email is required"],
    ["role", "Role is required"],
  ])("missing %s is rejected", (field, msg) => {
    const body = { ...valid };
    delete body[field];
    expect(errFor(schema, body, field)).toBe(msg);
  });

  test("a whitespace-only name is treated as empty", () => {
    expect(errFor(schema, { ...valid, name: "   " }, "name")).toBe("Name is required");
  });

  test("an invalid email is rejected on format", () => {
    expect(errFor(schema, { ...valid, email: "not-an-email" }, "email")).toBe("Enter a valid email");
  });

  test("a non-10-digit phone is rejected", () => {
    expect(errFor(schema, { ...valid, phone: "12345" }, "phone")).toBe("Phone must be a valid 10-digit mobile number");
  });

  test("the 'Select role' placeholder (empty string) is not a valid role", () => {
    expect(errFor(schema, { ...valid, role: "" }, "role")).toBe("Role is required");
  });

  test("a missing temporary password is rejected", () => {
    const body = { ...valid };
    delete body.password;
    const r = schema.safeParse(body);
    expect(r.success).toBe(false);
    expect(r.error.issues.some((i) => i.path.join(".") === "password")).toBe(true);
  });

  test("a too-short password is rejected by the project's min-6 rule", () => {
    expect(errFor(schema, { ...valid, password: "123" }, "password")).toBe("Temporary Password must be at least 6 characters");
  });

  test("a whitespace-only password is treated as empty", () => {
    const r = schema.safeParse({ ...valid, password: "     " });
    expect(r.success).toBe(false);
    expect(r.error.issues.some((i) => i.path.join(".") === "password")).toBe(true);
  });
});

test("each schema rejects the OTHER portal's role", () => {
  expect(createUserBody.safeParse({ ...VALID, role: "seller_manager" }).success).toBe(false);
  expect(createSellerMemberBody.safeParse({ ...VALID, role: "operations_manager" }).success).toBe(false);
});
