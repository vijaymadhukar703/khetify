import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  saveSellerInfo, saveSellerContact, saveSellerVerification, submitSellerOnboarding,
} from "../../lib/sellerApi";

// Seller onboarding wizard — mirrors the company multi-step setup:
//   info → contact → verification → review/submit.
// Each step persists to /api/seller/onboarding/* (scoped to the authenticated
// seller) before advancing; review fires the final submit.
const STEPS = ["Business", "Contact", "Verification", "Review"];

const field = "block w-full h-11 px-3 rounded-lg border border-stone-300 outline-none focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/10 text-sm";
const Label = ({ children, required = true }) => (
  <label className="block text-xs font-bold text-stone-600 mb-1">
    {children}{required && <span className="text-[#EA2831] ml-0.5">*</span>}
  </label>
);
const Err = ({ e }) => (e ? <p className="text-red-500 text-xs font-medium mt-0.5">⚠ {e}</p> : null);

const SellerOnboarding = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [info, setInfo] = useState({ businessName: "", businessType: "", productCategories: "", yearStarted: "" });
  const [contact, setContact] = useState({ line: "", city: "", state: "", pincode: "", ownerName: "", officialEmail: "", officialPhone: "" });
  const [verif, setVerif] = useState({ gstin: "", pan: "", udyam: "" });
  const [fieldErrors, setFieldErrors] = useState({});

  // Every field on the active step is required. Review (step 3) has no inputs.
  const stepErrors = () => {
    const e = {};
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (step === 0) {
      if (!info.businessName.trim()) e.businessName = "Business name is required";
      if (!info.businessType.trim()) e.businessType = "Business type is required";
      if (info.productCategories.split(",").map((s) => s.trim()).filter(Boolean).length === 0)
        e.productCategories = "Add at least one category";
      const yr = info.yearStarted.trim();
      if (!yr) e.yearStarted = "Year started is required";
      else if (!/^[0-9]{4}$/.test(yr) || Number(yr) > new Date().getFullYear() || Number(yr) < 1800) e.yearStarted = "Enter a valid year";
    } else if (step === 1) {
      if (!contact.line.trim()) e.line = "Address line is required";
      if (!contact.city.trim()) e.city = "City is required";
      if (!contact.state.trim()) e.state = "State is required";
      if (!/^[0-9]{6}$/.test(contact.pincode.trim())) e.pincode = "Pincode must be 6 digits";
      if (!contact.ownerName.trim()) e.ownerName = "Owner name is required";
      if (!emailRe.test(contact.officialEmail.trim())) e.officialEmail = "Enter a valid email";
      if (!/^[0-9]{10}$/.test(contact.officialPhone.trim())) e.officialPhone = "Phone must be 10 digits";
    } else if (step === 2) {
      if (!verif.gstin.trim()) e.gstin = "GSTIN is required";
      if (!verif.pan.trim()) e.pan = "PAN is required";
      if (!verif.udyam.trim()) e.udyam = "Udyam number is required";
    }
    return e;
  };
  const isStepValid = Object.keys(stepErrors()).length === 0;

  const next = () => { setFieldErrors({}); setStep((s) => Math.min(STEPS.length - 1, s + 1)); };
  const back = () => { setFieldErrors({}); setStep((s) => Math.max(0, s - 1)); };

  const saveStep = async () => {
    setError("");
    const errs = stepErrors();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    try {
      if (step === 0) {
        await saveSellerInfo({
          businessName: info.businessName,
          businessType: info.businessType,
          productCategories: info.productCategories
            ? info.productCategories.split(",").map((s) => s.trim()).filter(Boolean)
            : [],
          yearStarted: info.yearStarted,
        });
      } else if (step === 1) {
        await saveSellerContact({
          address: { line: contact.line, city: contact.city, state: contact.state, pincode: contact.pincode },
          ownerName: contact.ownerName,
          officialEmail: contact.officialEmail,
          officialPhone: contact.officialPhone,
        });
      } else if (step === 2) {
        await saveSellerVerification({ gstin: verif.gstin, pan: verif.pan, udyam: verif.udyam });
      }
      next();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      await submitSellerOnboarding();
      navigate("/seller/hub");
    } catch (err) {
      setError(err.response?.data?.message || "Could not submit. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-[#f8f6f6] min-h-screen flex flex-col items-center py-10 px-4 font-sora">
      <div className="w-full max-w-[640px]">
        <div className="text-center mb-6">
          <h1 className="text-[#EA2831] text-3xl font-bold tracking-tight">Khetify</h1>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-stone-400">Seller Onboarding</p>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-between mb-6">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1 flex items-center">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${i <= step ? "bg-[#EA2831] text-white" : "bg-stone-200 text-stone-500"}`}>{i + 1}</div>
              <span className={`ml-2 text-xs font-bold ${i <= step ? "text-stone-800" : "text-stone-400"}`}>{label}</span>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-2 ${i < step ? "bg-[#EA2831]" : "bg-stone-200"}`} />}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 sm:p-8">
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-stone-900">Business details</h2>
              <div><Label>Business name</Label><input className={field} value={info.businessName} onChange={(e) => setInfo({ ...info, businessName: e.target.value })} /><Err e={fieldErrors.businessName} /></div>
              <div><Label>Business type</Label><input className={field} value={info.businessType} onChange={(e) => setInfo({ ...info, businessType: e.target.value })} placeholder="e.g. Distributor, Retailer" /><Err e={fieldErrors.businessType} /></div>
              <div><Label>Product categories (comma separated)</Label><input className={field} value={info.productCategories} onChange={(e) => setInfo({ ...info, productCategories: e.target.value })} placeholder="Seeds, Fertilizers" /><Err e={fieldErrors.productCategories} /></div>
              <div><Label>Year started</Label><input className={field} value={info.yearStarted} onChange={(e) => setInfo({ ...info, yearStarted: e.target.value })} placeholder="2018" /><Err e={fieldErrors.yearStarted} /></div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-stone-900">Contact &amp; address</h2>
              <div><Label>Owner / contact person</Label><input className={field} value={contact.ownerName} onChange={(e) => setContact({ ...contact, ownerName: e.target.value })} /><Err e={fieldErrors.ownerName} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Official email</Label><input className={field} value={contact.officialEmail} onChange={(e) => setContact({ ...contact, officialEmail: e.target.value })} /><Err e={fieldErrors.officialEmail} /></div>
                <div><Label>Official phone</Label><input className={field} value={contact.officialPhone} onChange={(e) => setContact({ ...contact, officialPhone: e.target.value })} /><Err e={fieldErrors.officialPhone} /></div>
              </div>
              <div><Label>Address line</Label><input className={field} value={contact.line} onChange={(e) => setContact({ ...contact, line: e.target.value })} /><Err e={fieldErrors.line} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>City</Label><input className={field} value={contact.city} onChange={(e) => setContact({ ...contact, city: e.target.value })} /><Err e={fieldErrors.city} /></div>
                <div><Label>State</Label><input className={field} value={contact.state} onChange={(e) => setContact({ ...contact, state: e.target.value })} /><Err e={fieldErrors.state} /></div>
                <div><Label>Pincode</Label><input className={field} value={contact.pincode} onChange={(e) => setContact({ ...contact, pincode: e.target.value })} /><Err e={fieldErrors.pincode} /></div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-stone-900">Verification</h2>
              <div><Label>GSTIN</Label><input className={field} value={verif.gstin} onChange={(e) => setVerif({ ...verif, gstin: e.target.value })} /><Err e={fieldErrors.gstin} /></div>
              <div><Label>PAN</Label><input className={field} value={verif.pan} onChange={(e) => setVerif({ ...verif, pan: e.target.value })} /><Err e={fieldErrors.pan} /></div>
              <div><Label>Udyam</Label><input className={field} value={verif.udyam} onChange={(e) => setVerif({ ...verif, udyam: e.target.value })} /><Err e={fieldErrors.udyam} /></div>
              <p className="text-[11px] text-stone-400">Document uploads are added in a later phase.</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3 text-sm">
              <h2 className="text-lg font-bold text-stone-900">Review &amp; submit</h2>
              <Row k="Business" v={`${info.businessName || "—"} · ${info.businessType || "—"}`} />
              <Row k="Categories" v={info.productCategories || "—"} />
              <Row k="Owner" v={contact.ownerName || "—"} />
              <Row k="Contact" v={`${contact.officialEmail || "—"} · ${contact.officialPhone || "—"}`} />
              <Row k="Address" v={[contact.line, contact.city, contact.state, contact.pincode].filter(Boolean).join(", ") || "—"} />
              <Row k="GSTIN / PAN" v={`${verif.gstin || "—"} · ${verif.pan || "—"}`} />
              <p className="text-[11px] text-stone-400 pt-2">Submitting sends your profile for approval. You can explore the portal meanwhile.</p>
            </div>
          )}

          {error && <p className="mt-4 text-sm font-medium text-red-600">⚠ {error}</p>}

          <div className="flex items-center justify-between mt-6">
            <button onClick={back} disabled={step === 0 || busy} className="text-sm font-bold text-stone-500 disabled:opacity-40">Back</button>
            {step < STEPS.length - 1 ? (
              <button onClick={saveStep} disabled={busy || !isStepValid} className="rounded-lg bg-[#EA2831] px-6 py-2.5 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed">
                {busy ? "Saving..." : "Save & continue"}
              </button>
            ) : (
              <button onClick={submit} disabled={busy} className="rounded-lg bg-[#EA2831] px-6 py-2.5 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-60">
                {busy ? "Submitting..." : "Submit"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const Row = ({ k, v }) => (
  <div className="flex justify-between border-b border-dashed border-stone-100 py-1.5">
    <span className="text-stone-400 font-semibold">{k}</span>
    <span className="text-stone-700 text-right">{v}</span>
  </div>
);

export default SellerOnboarding;
