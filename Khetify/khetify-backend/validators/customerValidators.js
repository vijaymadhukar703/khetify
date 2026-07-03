/**
 * Validate + normalise a seller customer/dealer payload. Mirrors the seller
 * Customers modal on the frontend so bad data can't slip past a direct API call.
 * Returns { error, value }:
 *   - error: a human-readable string (first problem found), or null
 *   - value: the cleaned body to persist (name trimmed, email lowercased,
 *            gstin uppercased, phone digits-only, address strings trimmed)
 *
 * Only Name is mandatory (matches the model + existing behaviour). Every other
 * field is optional but, WHEN provided, must be well-formed. Used by the SELLER
 * controller only — the shared customerService (company side) is untouched.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9]{10}$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PIN_RE = /^[0-9]{6}$/;
const NAME_TEXT_RE = /^[A-Za-z .-]{2,}$/; // city / state: letters, space, dot, hyphen
const ALLOWED_TYPES = ["retail", "business", "dealer"];
const CREDIT_MAX = 999999999;

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

function validateAndNormalizeCustomer(body = {}, { isUpdate = false } = {}) {
  const out = {};

  // ── Name ──
  if (!isUpdate || body.name !== undefined) {
    const name = str(body.name);
    if (!name) return { error: "Name is required" };
    if (name.length < 2) return { error: "Name must be at least 2 characters" };
    out.name = name;
  }

  // ── Type ──
  if (body.type !== undefined) {
    if (!ALLOWED_TYPES.includes(body.type)) return { error: "Invalid customer type" };
    out.type = body.type;
  }

  // ── Phone (optional; strip spaces/hyphens, then 10-digit Indian mobile) ──
  if (body.phone !== undefined && str(body.phone) !== "") {
    const phone = str(body.phone).replace(/[\s-]/g, "");
    if (!PHONE_RE.test(phone)) return { error: "Enter a valid 10-digit phone number" };
    out.phone = phone;
  }

  // ── Email (optional; store lowercased) ──
  if (body.email !== undefined && str(body.email) !== "") {
    const email = str(body.email).toLowerCase();
    if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address" };
    out.email = email;
  }

  // ── GSTIN (optional; store uppercased) ──
  let gstin = "";
  if (body.gstin !== undefined && str(body.gstin) !== "") {
    gstin = str(body.gstin).toUpperCase();
    if (!GSTIN_RE.test(gstin)) return { error: "Enter a valid 15-character GSTIN" };
    out.gstin = gstin;
  }

  // ── Address (validate + normalise the first/default address, if any) ──
  // Track the default address's state code so the GSTIN cross-check below can run
  // even when NO address object was supplied.
  let defaultStateCode = "";
  if (body.addresses !== undefined) {
    if (!Array.isArray(body.addresses)) return { error: "Invalid address" };
    const cleaned = [];
    for (const raw of body.addresses) {
      const a = raw || {};
      const line1 = str(a.line1);
      const city = str(a.city);
      const state = str(a.state);
      const stateCode = str(a.stateCode);
      const pincode = str(a.pincode);

      if (line1 && line1.length < 3) return { error: "Address line must be at least 3 characters" };
      if (city && !NAME_TEXT_RE.test(city)) return { error: "Enter a valid city name" };
      if (state && !NAME_TEXT_RE.test(state)) return { error: "Enter a valid state name" };
      if (pincode && !PIN_RE.test(pincode)) return { error: "Enter a valid 6-digit pincode" };
      if (stateCode && !/^[0-9]{2}$/.test(stateCode)) return { error: "Enter valid 2-digit GST state code" };

      if (!defaultStateCode && stateCode) defaultStateCode = stateCode;
      cleaned.push({
        label: a.label || "Default",
        line1, city, district: str(a.district), state, stateCode, pincode,
        isDefault: a.isDefault !== undefined ? !!a.isDefault : true,
      });
    }
    out.addresses = cleaned;
  }

  // GSTIN ⇒ a matching 2-digit state code is required (runs regardless of
  // whether an address object was supplied).
  if (gstin) {
    if (!defaultStateCode) return { error: "State code is required when GSTIN is provided" };
    if (defaultStateCode !== gstin.slice(0, 2)) return { error: "State code must match GSTIN state code" };
  }

  // ── Credit limit (optional; 0..CREDIT_MAX, decimals allowed) ──
  if (body.creditLimit !== undefined && str(body.creditLimit) !== "") {
    const n = Number(body.creditLimit);
    if (Number.isNaN(n) || n < 0 || n > CREDIT_MAX) return { error: "Enter a valid credit limit" };
    out.creditLimit = n;
  }

  // Pass through non-validated but allowed fields untouched.
  if (body.tags !== undefined) out.tags = body.tags;
  if (body.isActive !== undefined) out.isActive = body.isActive;

  return { error: null, value: out };
}

module.exports = { validateAndNormalizeCustomer, ALLOWED_TYPES };
