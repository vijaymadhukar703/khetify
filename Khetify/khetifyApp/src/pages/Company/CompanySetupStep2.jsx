import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import config from "../../../config/config";
import SelectWithOther from '../../Components/ims/SelectWithOther';

const CompanySetupStep2 = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  // State for form data
  const [formData, setFormData] = useState({
    companyName: '',
    businessType: '',
    productCategories: [], // Array for UI handling
    established: ''
  });

  // State for Category Dropdown
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  // Free-text value captured when the "Other" category is selected.
  const [otherCategory, setOtherCategory] = useState('');
  const dropdownRef = useRef(null);

  // Predefined Categories List
  const CATEGORY_OPTIONS = [
    "Seeds",
    "Fertilizers",
    "Pesticides",
    "Farm Machinery",
    "Irrigation Tools",
    "Organic Products",
    "Animal Feed",
    "Crop Protection",
    "Hardware & Tools",
    "Other"
  ];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle Text Inputs
  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // Handle Category Selection (Toggle Logic)
  const toggleCategory = (category) => {
    let updatedCategories;
    if (formData.productCategories.includes(category)) {
      // Remove if already exists
      updatedCategories = formData.productCategories.filter(c => c !== category);
    } else {
      // Add if new
      updatedCategories = [...formData.productCategories, category];
    }
    setFormData({ ...formData, productCategories: updatedCategories });
  };

  // Remove Tag Helper
  const removeCategory = (category, e) => {
    e.stopPropagation(); // Prevent dropdown from toggling
    const updatedCategories = formData.productCategories.filter(c => c !== category);
    setFormData({ ...formData, productCategories: updatedCategories });
  };

  // All fields required. Year must be a sensible 4-digit year ≤ current year.
  // "Other category" text is required only when "Other" is selected.
  const getErrors = () => {
    const e = {};
    if (!formData.companyName.trim()) e.companyName = "Company name is required";
    if (!formData.businessType.trim()) e.businessType = "Business type is required";
    if (formData.productCategories.length === 0) e.productCategories = "Select at least one product category";
    else if (formData.productCategories.includes('Other') && !otherCategory.trim()) e.productCategories = "Please specify your 'Other' category";
    const yr = String(formData.established).trim();
    if (!yr) e.established = "Year of establishment is required";
    else if (!/^[0-9]{4}$/.test(yr) || Number(yr) > new Date().getFullYear() || Number(yr) < 1800) e.established = "Enter a valid 4-digit year";
    return e;
  };
  const isValid = Object.keys(getErrors()).length === 0;

  const handleContinue = async (e) => {
    e.preventDefault();
    const errs = getErrors();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error("Please fill in all required fields.");
      return;
    }

    // Replace the literal "Other" with the user-entered category before saving.
    const finalCategories = formData.productCategories
      .map((c) => (c === 'Other' ? otherCategory.trim() : c))
      .filter(Boolean);

    setLoading(true);

    const companyId = localStorage.getItem("companyId");
    const token = localStorage.getItem("token");

    try {
      // Backend API Call
      const response = await axios.put(
        `${config.BASE_URL}company/update/${companyId}`,
        { 
            companyInfo: {
                companyName: formData.companyName,
                businessType: formData.businessType,
                established: formData.established,
                // --- FIX IS HERE ---
                // Array ko String mein convert kar rahe hain taki backend error na de
                // ["Seeds", "Fertilizers"] -> "Seeds, Fertilizers"
                productCategory: finalCategories.join(', ')
            } 
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.status === 200) {
        toast.success("Company details saved successfully!");
        setTimeout(() => navigate("/company-contact"), 2000); // Navigate to Step 3
      }
    } catch (error) {
      console.error("API Error:", error.response?.data);
      const msg = error.response?.data?.message || "Connection Error. Check Token.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="font-['Manrope',sans-serif] bg-[#f8f5f5] min-h-screen flex flex-col">
      <ToastContainer position="top-right" autoClose={3000} />
      
      {/* Navbar */}
      <nav className="w-full bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <h1 className="text-[#f20d0d] text-xl font-bold tracking-tight">Khetify</h1>
      </nav>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-[480px] bg-white rounded-xl shadow-lg border border-stone-100 p-8 sm:p-10">
          
          {/* Header */}
          <div className="text-center mb-6">
            <span className="text-stone-500 text-sm font-medium bg-stone-50 px-3 py-1 rounded-full border border-stone-100">Step 2 of 5</span>
            <h2 className="text-2xl font-bold mt-4 font-['Sora',sans-serif]">Company information</h2>
          </div>

          <form className="space-y-5" onSubmit={handleContinue}>
            
            {/* Company Name */}
            <div className="flex flex-col space-y-1">
              <label className="text-sm font-semibold text-stone-700">Company Legal Name<span className="text-[#EA2831] ml-0.5">*</span></label>
              <input 
                name="companyName" 
                required 
                value={formData.companyName}
                onChange={handleChange} 
                className="w-full h-11 px-3 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#f20d0d] transition-all"
                placeholder="e.g. Khetify Agritech Solutions Ltd."
              />
              {errors.companyName && <p className="text-red-500 text-xs font-medium">⚠ {errors.companyName}</p>}
            </div>

            {/* Business Type */}
            <div className="flex flex-col space-y-1">
              <label className="text-sm font-semibold text-stone-700">Business Type<span className="text-[#EA2831] ml-0.5">*</span></label>
              <SelectWithOther
                name="businessType"
                required
                value={formData.businessType}
                onChange={(v) => setFormData({ ...formData, businessType: v })}
                className="w-full h-11 px-3 border border-stone-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-[#f20d0d] transition-all"
                placeholder="Select business type"
                otherPlaceholder="Enter your business type"
                options={[
                  'Private Limited Company',
                  'Public Limited Company',
                  'Partnership Firm',
                  'Sole Proprietorship',
                  'Limited Liability Partnership',
                ]}
              />
              {errors.businessType && <p className="text-red-500 text-xs font-medium">⚠ {errors.businessType}</p>}
            </div>

            {/* Primary Product Categories - MULTI SELECT FIXED */}
            <div className="flex flex-col space-y-1 relative" ref={dropdownRef}>
              <label className="text-sm font-semibold text-stone-700">Primary Product Categories<span className="text-[#EA2831] ml-0.5">*</span></label>
              
              {/* Fake Input Box that acts as Trigger */}
              <div 
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className={`w-full min-h-[44px] px-3 py-2 border rounded-lg bg-white cursor-pointer flex flex-wrap gap-2 items-center ${isDropdownOpen ? 'ring-2 ring-[#f20d0d] border-transparent' : 'border-stone-300'}`}
              >
                {formData.productCategories.length === 0 ? (
                  <span className="text-gray-400">Select categories...</span>
                ) : (
                  formData.productCategories.map((cat, index) => (
                    <span key={index} className="bg-red-50 text-[#f20d0d] text-xs font-semibold px-2 py-1 rounded-full flex items-center gap-1 border border-red-100">
                      {cat}
                      <button 
                        type="button" 
                        onClick={(e) => removeCategory(cat, e)}
                        className="hover:text-red-800 font-bold"
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
                <div className="ml-auto text-gray-400">▼</div>
              </div>

              {/* Dropdown List */}
              {isDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-20 max-h-60 overflow-y-auto">
                  {CATEGORY_OPTIONS.map((option) => (
                    <div 
                      key={option}
                      onClick={() => toggleCategory(option)}
                      className="px-4 py-2 hover:bg-gray-50 cursor-pointer flex items-center gap-3 text-sm text-stone-700"
                    >
                      <input 
                        type="checkbox" 
                        checked={formData.productCategories.includes(option)}
                        readOnly
                        className="accent-[#f20d0d] w-4 h-4"
                      />
                      {option}
                    </div>
                  ))}
                </div>
              )}

              {/* Ask for the custom category when "Other" is selected */}
              {formData.productCategories.includes('Other') && (
                <input
                  type="text"
                  value={otherCategory}
                  onChange={(e) => setOtherCategory(e.target.value)}
                  className="w-full h-11 px-3 mt-2 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#f20d0d] transition-all"
                  placeholder="Please specify your category"
                />
              )}
              {errors.productCategories && <p className="text-red-500 text-xs font-medium">⚠ {errors.productCategories}</p>}
            </div>

            {/* Year of Establishment */}
            <div className="flex flex-col space-y-1">
              <label className="text-sm font-semibold text-stone-700">Year of Establishment<span className="text-[#EA2831] ml-0.5">*</span></label>
              <input 
                name="established" 
                required 
                type="number"
                value={formData.established}
                onChange={handleChange} 
                className="w-full h-11 px-3 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#f20d0d] transition-all" 
                placeholder="YYYY"
                min="1800"
                max={new Date().getFullYear()}
              />
              {errors.established && <p className="text-red-500 text-xs font-medium">⚠ {errors.established}</p>}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || !isValid}
              className="w-full bg-[#f20d0d] hover:bg-red-700 text-white font-bold h-12 rounded-lg transition-all active:scale-[0.98] shadow-md mt-4 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Saving..." : "Continue"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default CompanySetupStep2;