import React from "react";

// Full-screen auth background: the wheat-field photo with a dark overlay,
// behind a centered white card. Matches the company auth pages
// (CompanyLogin / CompanyRegister) so every login/register screen is identical.
// Children render inside the centered `relative z-10` container.
const AuthBackground = ({ children }) => (
  <div className="bg-[#f8f6f6] min-h-screen flex flex-col relative overflow-y-auto font-['Sora',sans-serif] antialiased">
    <div className="fixed inset-0 z-0 pointer-events-none">
      <div className="absolute inset-0 bg-black/30 z-10"></div>
      <div
        className="w-full h-full bg-cover bg-center"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1500382017468-9049fed747ef?ixlib=rb-4.0.3&auto=format&fit=crop&w=2400&q=80')",
        }}
      ></div>
    </div>

    <div className="relative z-10 flex flex-col items-center justify-center min-h-screen p-4 py-12">
      {children}
    </div>
  </div>
);





export default AuthBackground;
