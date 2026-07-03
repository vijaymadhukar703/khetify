import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import config from "../../../config/config";

const CompanySetupStep3 = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  // 1. State initialization matching backend 'businessContact' schema
  const [formData, setFormData] = useState({
    address: '',
    region: '',
    authorizedPerson: '',
    businessEmail: '',
    businessNumber: ''
  });

  // All contact fields required; official email must be valid, phone 10 digits.
  const getErrors = () => {
    const e = {};
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.address.trim()) e.address = "Business address is required";
    if (!formData.region.trim()) e.region = "Operating region is required";
    if (!formData.authorizedPerson.trim()) e.authorizedPerson = "Authorized person is required";
    if (!formData.businessEmail.trim()) e.businessEmail = "Official email is required";
    else if (!emailRe.test(formData.businessEmail.trim())) e.businessEmail = "Enter a valid email";
    if (!formData.businessNumber.trim()) e.businessNumber = "Official phone is required";
    else if (!/^[0-9]{10}$/.test(formData.businessNumber.trim())) e.businessNumber = "Phone must be 10 digits";
    return e;
  };

  // Fonts loading logic
  useEffect(() => {
    const fonts = [
      "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&family=Sora:wght@400;600;700&display=swap",
      "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
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

  const handleContinue = async (e) => {
    e.preventDefault();
    const errs = getErrors();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setLoading(true);

    const companyId = localStorage.getItem("companyId");
    const token = localStorage.getItem("token");

    if (!companyId || !token) {
      toast.error("Session expired. Please login again.");
      navigate("/login");
      return;
    }

    try {
      // 2. API call to update the 'businessContact' section
      const response = await axios.put(
        `${config.BASE_URL}company/update/${companyId}`,
        { businessContact: formData }, 
        { 
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          } 
        }
      );

      if (response.status === 200 || response.data.message.includes("success")) {
        toast.success("Contact details saved successfully!");
        // Navigation to Step 4 after a short delay
        setTimeout(() => {
          navigate("/company-verification"); 
        }, 1500);
      }
    } catch (error) {
      console.error("Step 3 Save Error:", error.response?.data);
      const msg = error.response?.data?.message || "Server error. Please try again.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="font-['Manrope',sans-serif] bg-[#f8f5f5] min-h-screen flex flex-col text-stone-900">
      <ToastContainer position="top-right" autoClose={3000} />
      
      {/* Top Navbar */}
      <nav className="w-full bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <h1 className="text-[#f20d0d] text-xl font-bold tracking-tight">Khetify</h1>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-[480px] bg-white rounded-xl shadow-lg border border-stone-100 flex flex-col overflow-hidden">
          <div className="p-8 sm:p-10 flex flex-col h-full">
            
            {/* Step Indicator */}
            <div className="w-full flex justify-center mb-6">
              <span className="text-stone-500 text-sm font-medium bg-stone-50 px-3 py-1 rounded-full border border-stone-100">
                Step 3 of 5
              </span>
            </div>

            <h2 className="text-2xl font-bold text-center text-stone-900 mb-8 font-['Sora',sans-serif]">
              Business and contact details
            </h2>

            <form className="space-y-5 mb-8" noValidate onSubmit={handleContinue}>
              {/* Address */}
              <div className="flex flex-col space-y-2">
                <label className="text-sm text-stone-700 font-['Sora',sans-serif]">Registered Business Address<span className="text-[#EA2831] ml-0.5">*</span></label>
                <input 
                  type="text"
                  name="address"
                  placeholder="e.g. 1234 Harvest Lane, Agri Park"
                  className="w-full h-11 px-3 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#f20d0d] transition-all"
                  onChange={handleChange}
                />
                {errors.address && <p className="text-red-500 text-xs font-medium">⚠ {errors.address}</p>}
              </div>

              {/* Regions */}
              <div className="flex flex-col space-y-2">
                <label className="text-sm text-stone-700 font-['Sora',sans-serif]">Operating Regions<span className="text-[#EA2831] ml-0.5">*</span></label>
                <input 
                  type="text"
                  name="region"
                  placeholder="e.g. North India, Maharashtra, Punjab"
                  className="w-full h-11 px-3 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#f20d0d] transition-all"
                  onChange={handleChange}
                />
                {errors.region && <p className="text-red-500 text-xs font-medium">⚠ {errors.region}</p>}
              </div>

              {/* Person Name */}
              <div className="flex flex-col space-y-2">
                <label className="text-sm text-stone-700 font-['Sora',sans-serif]">Authorized Person Name<span className="text-[#EA2831] ml-0.5">*</span></label>
                <input 
                  type="text"
                  name="authorizedPerson"
                  placeholder="e.g. Rajesh Kumar"
                  className="w-full h-11 px-3 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#f20d0d] transition-all"
                  onChange={handleChange}
                />
                {errors.authorizedPerson && <p className="text-red-500 text-xs font-medium">⚠ {errors.authorizedPerson}</p>}
              </div>

              {/* Official Email */}
              <div className="flex flex-col space-y-2">
                <label className="text-sm text-stone-700 font-['Sora',sans-serif]">Official Business Email<span className="text-[#EA2831] ml-0.5">*</span></label>
                <input 
                  type="text"
                  name="businessEmail"
                  placeholder="e.g. contact@khetify.com"
                  className="w-full h-11 px-3 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#f20d0d] transition-all"
                  onChange={handleChange}
                />
                {errors.businessEmail && <p className="text-red-500 text-xs font-medium">⚠ {errors.businessEmail}</p>}
              </div>

              {/* Phone Number */}
              <div className="flex flex-col space-y-2">
                <label className="text-sm text-stone-700 font-['Sora',sans-serif]">Official Business Phone Number<span className="text-[#EA2831] ml-0.5">*</span></label>
                <input 
                  type="text"
                  name="businessNumber"
                  placeholder="e.g. 9876543210"
                  className="w-full h-11 px-3 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#f20d0d] transition-all"
                  onChange={handleChange}
                />
                {errors.businessNumber && <p className="text-red-500 text-xs font-medium">⚠ {errors.businessNumber}</p>}
              </div>

              {/* Continue Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center bg-[#f20d0d] hover:bg-red-700 text-white font-bold h-12 rounded-lg transition-all active:scale-[0.98] shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? "Saving..." : "Continue"}
              </button>
            </form>
          </div>

          {/* Progress Bar (60% complete) */}
          <div className="h-1 w-full bg-stone-100">
            <div className="h-full w-3/5 bg-[#f20d0d] rounded-r-full transition-all duration-700"></div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default CompanySetupStep3;