import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const CompanySetup = () => {
  const navigate = useNavigate();
  const [userName, setUserName] = useState("User");

  useEffect(() => {
    // 1. Check if user is logged in
    const token = localStorage.getItem("token");
    const companyId = localStorage.getItem("companyId");
    // 2. Fetching dynamic name from localStorage
    const storedName = localStorage.getItem("userName");
    if (!token || !companyId) {
      navigate("/login");
      return;
    }
    if (storedName) {
      setUserName(storedName);
    }
  }, [navigate]);

  // Initial letters for profile icon logic
  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  return (
    <div className="font-['Manrope',sans-serif] bg-[#f8f5f5] min-h-screen flex flex-col text-stone-900">
      {/* Top Navigation Bar with Dynamic Name */}
      <nav className="w-full bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <h1 className="text-[#f20d0d] text-xl font-bold tracking-tight">Khetify</h1>
        </div>
        <div className="flex items-center gap-4">
          {/* Sarah ki jagah dynamic name display */}
          <span className="text-sm font-medium text-stone-600 hidden sm:block uppercase">
            {userName}
          </span>
          <div className="w-10 h-10 rounded-full bg-stone-200 flex items-center justify-center border border-stone-100 font-bold text-stone-600 uppercase">
            {initials || "U"}
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-[480px] bg-white rounded-xl shadow-lg border border-stone-100 flex flex-col overflow-hidden animate-fade-in-up">
          <div className="p-8 sm:p-10 flex flex-col h-full">
            
            <div className="w-full flex justify-center mb-6">
              <span className="text-stone-500 text-sm font-medium bg-stone-50 px-3 py-1 rounded-full border border-stone-100">
                Getting Started
              </span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-bold text-center text-stone-900 mb-4 leading-tight font-['Sora',sans-serif]">
              Set up your company profile
            </h2>

            <p className="text-base text-stone-600 text-center leading-relaxed mb-10">
              Please complete your organization's details to verify your account and activate full access to the platform. 
              This helps us ensure a secure environment for all partners.
            </p>

            <div className="mt-auto">
              <button 
                onClick={() => navigate("/company-info")}
                className="w-full flex items-center justify-center bg-[#f20d0d] hover:bg-red-700 text-white text-base font-bold h-12 rounded-lg transition-all duration-200 active:scale-[0.98] shadow-md"
              >
                Start setup
              </button>
            </div>
          </div>

          {/* Progress Bar at Bottom (Initial Phase) */}
          <div className="h-1.5 w-full bg-stone-100">
            <div className="h-full w-[5%] bg-[#f20d0d] transition-all duration-500"></div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default CompanySetup;