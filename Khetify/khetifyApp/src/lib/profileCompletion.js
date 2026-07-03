// Shared profile-completion helper used by BOTH portals (company + seller) so
// the percentage and "what's missing" list are computed identically over each
// portal's own registration/KYC field set.
//
// Pass an ordered list of checks: [{ label, ok }]. `ok` is truthy when the
// field/doc is present. Returns the percentage, counts, and the labels of the
// still-missing items (in order) for the "Add: …" hint.
export function profileCompletion(checks = []) {
  const total = checks.length;
  const done = checks.filter((c) => c.ok).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const missing = checks.filter((c) => !c.ok).map((c) => c.label);
  return { pct, done, total, missing };
}

// Build the canonical check list from a normalized profile model (the shape the
// backend /profile endpoints return). Identical fields for company and seller:
// business name, contact person, email, phone, address, GSTIN, PAN, GST
// certificate, PAN file. Keeps both portals consistent.
export function profileChecks(model = {}) {
  const id = model.identity || {};
  const c = model.compliance || {};
  const has = (v) => !!(v && String(v).trim());
  return [
    { label: 'Business name', ok: has(id.businessName) },
    { label: 'Contact person', ok: has(id.contactPerson) },
    { label: 'Email', ok: has(id.email) },
    { label: 'Phone', ok: has(id.phone) },
    { label: 'Address', ok: has(id.address) },
    { label: 'GSTIN', ok: has(c.gstin) },
    { label: 'PAN', ok: has(c.pan) },
    { label: 'GST certificate', ok: has(c.gstCertificateUrl) },
    { label: 'PAN file', ok: has(c.panFileUrl) },
  ];
}
