/**
 * GST tax computation. Within India:
 *   - intra-state (supplier state == customer state) → CGST + SGST (split evenly)
 *   - inter-state (different states)                 → IGST (full rate)
 *
 * State is identified by the GST state code (first 2 digits of a GSTIN, or an
 * explicit address stateCode). When the customer's state is unknown we default
 * to intra-state (the safe, most common B2C case).
 */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Derive a 2-digit GST state code from a GSTIN, else null. */
function stateCodeFromGstin(gstin) {
  if (!gstin || gstin.length < 2) return null;
  const code = String(gstin).slice(0, 2);
  return /^[0-9]{2}$/.test(code) ? code : null;
}

/**
 * @param {object} p
 * @param {number} p.taxable      line taxable value (qty × price)
 * @param {number} p.gstRate      GST % (e.g. 18)
 * @param {string} [p.hsnCode]
 * @param {string} [p.companyStateCode]
 * @param {string} [p.customerStateCode]
 * @returns {{ hsnCode, gstRate, taxable, cgst, sgst, igst }}
 */
function computeLineTax({ taxable, gstRate = 0, hsnCode, companyStateCode, customerStateCode }) {
  taxable = round2(Number(taxable) || 0);
  const rate = Number(gstRate) || 0;
  const totalTax = round2((taxable * rate) / 100);

  // Inter-state only when BOTH codes are known and differ.
  const interState = !!(companyStateCode && customerStateCode && companyStateCode !== customerStateCode);

  if (interState) {
    return { hsnCode, gstRate: rate, taxable, cgst: 0, sgst: 0, igst: totalTax };
  }
  const half = round2(totalTax / 2);
  return { hsnCode, gstRate: rate, taxable, cgst: half, sgst: round2(totalTax - half), igst: 0 };
}

module.exports = { computeLineTax, stateCodeFromGstin, round2 };
