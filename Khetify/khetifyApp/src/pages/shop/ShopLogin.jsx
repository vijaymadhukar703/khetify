import React, { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useShopAuth } from "../../context/ShopAuthContext";
import { shopVerifyOtp, shopResendOtp } from "../../lib/shopApi";

const inputCls = "w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:border-stone-400 outline-none";

export default function ShopLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login, register } = useShopAuth();
  const redirect = params.get("redirect") || "/customer-shop";

  const [mode, setMode] = useState(params.get("mode") === "register" ? "register" : "login");
  const [form, setForm] = useState({ name: "", email: "", phone: "", identifier: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState("");
  const [notice, setNotice] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      if (mode === "login") {
        await login(form.identifier, form.password);
        navigate(redirect, { replace: true });
      } else {
        const res = await register({ name: form.name, email: form.email, phone: form.phone, password: form.password });
        if (form.email) {
          setOtpStep(true);
          setNotice(res.otpSent
            ? `We sent a 6-digit code to ${form.email}.`
            : "Account created. (Email sending isn't configured — check the server console for your code, or skip verification.)");
        } else {
          navigate(redirect, { replace: true });
        }
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await shopVerifyOtp(otp);
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err?.response?.data?.message || "Invalid code");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(""); setNotice("");
    try {
      const res = await shopResendOtp();
      setNotice(res.otpSent ? "A new code has been sent." : "Code generated — check the server console (email not configured).");
    } catch (err) {
      setError(err?.response?.data?.message || "Could not resend code");
    }
  };

  const skip = () => navigate(redirect, { replace: true });

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <div className="bg-white rounded-3xl border border-stone-200 shadow-sm p-6 sm:p-8">
        <div className="flex items-center gap-2 mb-5">
          <span className="material-symbols-outlined text-[#EA2831] text-2xl">storefront</span>
          <span className="font-bold text-stone-900">Khetify</span>
        </div>

        {!otpStep ? (
          <>
            <h1 className="text-xl font-bold text-stone-900 mb-1">
              {mode === "login" ? "Login to continue" : "Create your account"}
            </h1>
            <p className="text-sm text-stone-500 mb-5">
              {mode === "login" ? "Enter your email/phone and password." : "Sign up to place your order."}
            </p>

            {error && <div className="mb-3 text-sm text-[#EA2831] bg-red-50 rounded-lg px-3 py-2">{error}</div>}

            <form onSubmit={submit} className="space-y-3">
              {mode === "register" && (
                <>
                  <input required value={form.name} onChange={set("name")} placeholder="Full name" className={inputCls} />
                  <input type="email" value={form.email} onChange={set("email")} placeholder="Email (recommended)" className={inputCls} />
                  <input value={form.phone} onChange={set("phone")} placeholder="Phone" className={inputCls} />
                  <p className="text-xs text-stone-400">Provide at least one of email or phone.</p>
                </>
              )}
              {mode === "login" && (
                <input required value={form.identifier} onChange={set("identifier")} placeholder="Email or phone" className={inputCls} />
              )}
              <input required type="password" value={form.password} onChange={set("password")} placeholder="Password" className={inputCls} />

              <button disabled={busy} className="w-full py-3 rounded-lg bg-[#EA2831] text-white font-semibold hover:bg-[#d21f27] disabled:opacity-60">
                {busy ? "Please wait…" : mode === "login" ? "Login" : "Create account"}
              </button>
            </form>

            <p className="text-sm text-stone-500 mt-4 text-center">
              {mode === "login" ? (
                <>New here? <button onClick={() => { setMode("register"); setError(""); }} className="text-[#EA2831] font-semibold">Create an account</button></>
              ) : (
                <>Already have an account? <button onClick={() => { setMode("login"); setError(""); }} className="text-[#EA2831] font-semibold">Login</button></>
              )}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-stone-900 mb-1">Verify your email</h1>
            {notice && <p className="text-sm text-stone-500 mb-4">{notice}</p>}
            {error && <div className="mb-3 text-sm text-[#EA2831] bg-red-50 rounded-lg px-3 py-2">{error}</div>}
            <form onSubmit={verify} className="space-y-3">
              <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="Enter 6-digit code" maxLength={6} className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-center tracking-[0.4em] text-lg bg-white focus:border-stone-400 outline-none" />
              <button disabled={busy || otp.length < 4} className="w-full py-3 rounded-lg bg-[#EA2831] text-white font-semibold hover:bg-[#d21f27] disabled:opacity-60">
                {busy ? "Verifying…" : "Verify & continue"}
              </button>
            </form>
            <div className="flex justify-between mt-4 text-sm">
              <button onClick={resend} className="text-[#EA2831] font-semibold">Resend code</button>
              <button onClick={skip} className="text-stone-500 hover:text-stone-800">Skip for now →</button>
            </div>
          </>
        )}

        <div className="mt-6 text-center">
          <Link to="/customer-shop" className="text-xs text-stone-400 hover:text-stone-600">← Continue shopping</Link>
        </div>
      </div>
    </div>
  );
}
