import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const CompanyApprovalSuccess = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Fonts load karne ke liye
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

  return (
    <div className="font-['Manrope',sans-serif] bg-[#f8f5f5] min-h-screen flex flex-col text-stone-900">
      {/* Navbar */}
      <nav className="w-full bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <h1 className="text-[#f20d0d] text-xl font-bold tracking-tight">Khetify</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-stone-600 hidden sm:block">Sarah</span>
          <div className="w-10 h-10 rounded-full bg-stone-200 border border-stone-100 flex items-center justify-center font-bold text-stone-600">S</div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-[480px] bg-white rounded-xl shadow-lg border border-stone-100 flex flex-col overflow-hidden animate-fade-in-up">
          <div className="p-8 sm:p-12 flex flex-col items-center text-center h-full min-h-[400px]">
            
            {/* Check Icon */}
            <div className="mb-6">
              <div className="h-16 w-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto">
                <span className="material-symbols-outlined text-stone-400 text-3xl font-bold">check</span>
              </div>
            </div>

            {/* Headline */}
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-stone-900 leading-tight font-['Sora',sans-serif]">
                Your company has been approved
              </h2>
            </div>

            {/* Status Badge */}
            <div className="mb-8">
              <span className="inline-flex items-center justify-center px-4 py-1.5 rounded-full bg-[#EA2831]/10 text-[#EA2831] font-['Sora',sans-serif] font-semibold text-sm">
                Verified
              </span>
            </div>

            {/* Body Text */}
            <div className="mb-10 max-w-sm mx-auto">
              <p className="text-stone-500 font-['Sora',sans-serif] font-normal text-base leading-relaxed">
                Your company profile has been successfully verified. You can now access your company dashboard and start managing products. All features are now available based on your role.
              </p>
            </div>

            {/* Action Button */}
            <div className="mt-auto w-full">
              <button 
                onClick={() => navigate("/hub")}
                className="w-full bg-[#EA2831] hover:bg-[#d61f28] text-white font-['Sora',sans-serif] font-semibold py-3.5 px-6 rounded-lg transition-all active:scale-[0.98] shadow-md"
              >
                Go to dashboard
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default CompanyApprovalSuccess;