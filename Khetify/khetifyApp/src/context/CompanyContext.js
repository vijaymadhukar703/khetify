import React, { createContext, useContext, useState, useEffect } from "react";

const CompanyContext = createContext();

export const CompanyProvider = ({ children }) => {
  const [company, setCompany] = useState(null);

  // App start pe localStorage check
  useEffect(() => {
    const storedCompany = localStorage.getItem("company");
    if (storedCompany) {
      setCompany(JSON.parse(storedCompany));
    }
  }, []);

  const registerCompany = (data) => {
    const companyData = {
      fullName: data.fullName,
      email: data.email,
      number: data.number,
      token: data.token,
    };

    setCompany(companyData);
    localStorage.setItem("company", JSON.stringify(companyData));
  };

  const logoutCompany = () => {
    setCompany(null);
    localStorage.removeItem("company");
  };

  return (
    <CompanyContext.Provider
      value={{
        company,
        registerCompany,
        logoutCompany,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
};

export const useCompany = () => useContext(CompanyContext);
