import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import config from "../../../config/config";

const CompanySetupStep4 = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

const [formData, setFormData] = useState({
  gstinNumber: "",
  udyamIncorporationNumber: "",
  panNumber: "",
});
  const [gstFile, setGstFile] = useState(null);
  const [regFile, setRegFile] = useState(null);
  const [panFile, setPanFile] = useState(null);

  // Verification ids AND their uploads are all required, ids must match format.
  const getErrors = () => {
    const e = {};
    // Indian govt ID formats (validated case-insensitively, normalized to uppercase)
    const panRe = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
    const gstinRe = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
    const udyamRe = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
    const cinRe = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;

    const gstin = formData.gstinNumber.trim().toUpperCase();
    const udyam = formData.udyamIncorporationNumber.trim().toUpperCase();
    const pan = formData.panNumber.trim().toUpperCase();

    if (!gstin) e.gstinNumber = "GSTIN is required";
    else if (!gstinRe.test(gstin)) e.gstinNumber = "Enter a valid 15-character GSTIN";

    if (!gstFile) e.gstCertificate = "Upload the GST certificate";

    if (!udyam) e.udyamIncorporationNumber = "Udyam/Incorporation number is required";
    else if (!udyamRe.test(udyam) && !cinRe.test(udyam))
      e.udyamIncorporationNumber = "Enter a valid Udyam (UDYAM-XX-00-0000000) or CIN number";

    if (!regFile) e.registrationCertificate = "Upload the registration certificate";

    if (!pan) e.panNumber = "PAN number is required";
    else if (!panRe.test(pan)) e.panNumber = "Enter a valid PAN (e.g. ABCDE1234F)";

    if (!panFile) e.panCard = "Upload the PAN card";
    return e;
  };

  useEffect(() => {
    const fonts = [
      "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&family=Sora:wght@400;600;700&display=swap",
      "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght@100..700&display=swap"
    ];
    fonts.forEach(url => {
      const link = document.createElement("link");
      link.href = url;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    });
  }, []);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

const handleFileChange = (e) => {
  if (e.target.name === "gstCertificate") setGstFile(e.target.files[0]);
  if (e.target.name === "registrationCertificate")
    setRegFile(e.target.files[0]);
  if (e.target.name === "panCard") setPanFile(e.target.files[0]);
};

   const handleContinue = async (e) => {
     e.preventDefault();
     const errs = getErrors();
     setErrors(errs);
     if (Object.keys(errs).length > 0) {
       toast.error("Please complete all verification fields and uploads.");
       return;
     }
     setLoading(true);

     const companyId = localStorage.getItem("companyId");
     const token = localStorage.getItem("token");

     const data = new FormData();

     data.append("gstinNumber", formData.gstinNumber.trim().toUpperCase());
     data.append("udyamIncorporationNumber", formData.udyamIncorporationNumber.trim().toUpperCase());
     data.append("panNumber", formData.panNumber.trim().toUpperCase());

     if (gstFile) data.append("gstCertificate", gstFile);
     if (regFile) data.append("registrationCertificate", regFile);
     if (panFile) data.append("panCard", panFile);

     try {
       await axios.put(`${config.BASE_URL}company/update/${companyId}`, data, {
         headers: {
           Authorization: `Bearer ${token}`,
         },
       });

       toast.success("Verification documents uploaded!");
       setTimeout(() => {
         navigate("/company-final");
       }, 1500);
     } catch (error) {
       console.error("Step 4 Error:", error.response?.data);
       toast.error(
         error.response?.data?.message || "Failed to upload documents.",
       );
     } finally {
       setLoading(false);
     }
   };
  return (
    <div className="font-['Manrope',sans-serif] bg-[#f8f5f5] min-h-screen flex flex-col text-stone-900">
      <ToastContainer position="top-right" autoClose={3000} />

      <nav className="w-full bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <h1 className="text-[#f20d0d] text-xl font-bold tracking-tight">
          Khetify
        </h1>
      </nav>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        <div className="w-full max-w-[480px] bg-white rounded-xl shadow-lg border border-stone-100 flex flex-col overflow-hidden my-8">
          <div className="p-8 sm:p-10 flex flex-col h-full">
            <div className="w-full flex justify-center mb-6">
              <span className="text-stone-500 text-sm font-medium bg-stone-50 px-3 py-1 rounded-full border border-stone-100">
                Step 4 of 5
              </span>
            </div>

            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-stone-900 leading-tight font-['Sora',sans-serif] mb-2">
                Business verification
              </h2>
              <p className="text-stone-500 text-sm font-['Sora',sans-serif]">
                Upload your certificates for faster verification.
              </p>
            </div>

            <form className="space-y-8 mb-8" noValidate onSubmit={handleContinue}>
              {/* GST Section */}
              <div className="space-y-4">
                <h3 className="text-base font-bold text-stone-900 font-['Sora',sans-serif] border-b border-stone-100 pb-2">
                  GST Details
                </h3>
                <div className="flex flex-col space-y-2">
                  <label className="text-sm text-stone-700">GSTIN Number<span className="text-[#EA2831] ml-0.5">*</span></label>
                  <input
                    name="gstinNumber"
                    type="text"
                    placeholder="Enter GSTIN Number"
                    className="w-full h-11 px-3 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#f20d0d]"
                    onChange={handleChange}
                  />
                  {errors.gstinNumber && <p className="text-red-500 text-xs font-medium">⚠ {errors.gstinNumber}</p>}
                </div>
                <div className="flex flex-col space-y-2">
                  <label className="text-sm text-stone-700">
                    Upload GST Certificate<span className="text-[#EA2831] ml-0.5">*</span>
                  </label>
                  <input
                    type="file"
                    name="gstCertificate"
                    onChange={handleFileChange}
                    className="block w-full text-sm text-stone-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-red-50 file:text-red-700 hover:file:bg-red-100 cursor-pointer"
                  />
                  {errors.gstCertificate && <p className="text-red-500 text-xs font-medium">⚠ {errors.gstCertificate}</p>}
                </div>
              </div>

              {/* Registration Section */}
              <div className="space-y-4">
                <h3 className="text-base font-bold text-stone-900 font-['Sora',sans-serif] border-b border-stone-100 pb-2">
                  Business Registration
                </h3>
                <div className="flex flex-col space-y-2">
                  <label className="text-sm text-stone-700">
                    Udyam/Incorporation Number<span className="text-[#EA2831] ml-0.5">*</span>
                  </label>
                  <input
                    name="udyamIncorporationNumber"
                    type="text"
                    placeholder="Enter Udyam/Incorporation Number"
                    className="w-full h-11 px-3 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#f20d0d]"
                    onChange={handleChange}
                  />
                  {errors.udyamIncorporationNumber && <p className="text-red-500 text-xs font-medium">⚠ {errors.udyamIncorporationNumber}</p>}
                </div>
                <div className="flex flex-col space-y-2">
                  <label className="text-sm text-stone-700">
                    Upload Udyam/Incorporation Certificate<span className="text-[#EA2831] ml-0.5">*</span>
                  </label>
                  <input
                    type="file"
                    name="registrationCertificate"
                    onChange={handleFileChange}
                    className="block w-full text-sm text-stone-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-red-50 file:text-red-700 hover:file:bg-red-100 cursor-pointer"
                  />
                  {errors.registrationCertificate && <p className="text-red-500 text-xs font-medium">⚠ {errors.registrationCertificate}</p>}
                </div>
              </div>

              {/* PAN Section - UPDATED */}
              <div className="space-y-4">
                <h3 className="text-base font-bold text-stone-900 font-['Sora',sans-serif] border-b border-stone-100 pb-2">
                  Tax Identification
                </h3>
                <div className="flex flex-col space-y-2">
                  <label className="text-sm text-stone-700">
                    PAN Card Number<span className="text-[#EA2831] ml-0.5">*</span>
                  </label>
                  <input
                    name="panNumber"
                    type="text"
                    placeholder="Enter PAN Number"
                    className="w-full h-11 px-3 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#f20d0d] uppercase"
                    onChange={handleChange}
                  />
                  {errors.panNumber && <p className="text-red-500 text-xs font-medium">⚠ {errors.panNumber}</p>}
                </div>
                {/* --- NEW: PAN Upload Input --- */}
                <div className="flex flex-col space-y-2">
                  <label className="text-sm text-stone-700">
                    Upload PAN Card<span className="text-[#EA2831] ml-0.5">*</span>
                  </label>
                  <input
                    type="file"
                    name="panCard"
                    onChange={handleFileChange}
                    className="block w-full text-sm text-stone-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-red-50 file:text-red-700 hover:file:bg-red-100 cursor-pointer"
                  />
                  {errors.panCard && <p className="text-red-500 text-xs font-medium">⚠ {errors.panCard}</p>}
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#f20d0d] hover:bg-red-700 text-white font-bold h-12 rounded-lg transition-all active:scale-[0.98] shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? "Uploading Documents..." : "Continue"}
              </button>
            </form>
          </div>

          <div className="h-1 w-full bg-stone-100">
            <div className="h-full w-4/5 bg-[#f20d0d] rounded-r-full transition-all duration-700"></div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default CompanySetupStep4;