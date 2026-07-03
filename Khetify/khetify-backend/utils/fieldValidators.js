/**
 * Small, dependency-free field validators shared by the company & seller
 * register/onboarding controllers. Inline (matches the existing companyController
 * / sellerAuthController style); not a joi schema, because the company onboarding
 * uses a SHARED partial-update endpoint where we can only validate the fields a
 * given request actually submits.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9]{10}$/;
const PIN_RE = /^[0-9]{6}$/;
// GSTIN: 2-digit state + 10-char PAN + entity digit + 'Z' + checksum char.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const isEmail = (v) => EMAIL_RE.test(String(v).trim());
const isPhone10 = (v) => PHONE_RE.test(String(v).trim());
const isPincode = (v) => PIN_RE.test(String(v).trim());
const isGstin = (v) => GSTIN_RE.test(String(v).trim().toUpperCase());
const isPan = (v) => PAN_RE.test(String(v).trim().toUpperCase());

/** A 4-digit year that is not in the future (and not absurdly old). */
function isValidYear(v) {
  const s = String(v).trim();
  if (!/^[0-9]{4}$/.test(s)) return false;
  const y = Number(s);
  return y >= 1800 && y <= new Date().getFullYear();
}

module.exports = { EMAIL_RE, PHONE_RE, PIN_RE, GSTIN_RE, PAN_RE, isBlank, isEmail, isPhone10, isPincode, isGstin, isPan, isValidYear };
