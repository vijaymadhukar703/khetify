import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import config from "../../../config/config";

const CompanyInfo = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    companyName: '',
    businessType: '',
    productCategory: '',
    established: ''
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleNext = async (e) => {
    e.preventDefault();
    const companyId = localStorage.getItem("companyId");
    const token = localStorage.getItem("token");

    // --- CORRECTION HERE ---
    // Hum yahan .split() nahi lagayenge.
    // Hum seedha string bhejenge taki Backend ka "Cast to String" error na aaye.
    // Backend mein ye "Seeds, Fertilizers" ek single text ki tarah save hoga.
    
    try {
      const response = await axios.put(
        `${config.BASE_URL}company/update/${companyId}`,
        { 
          companyInfo: formData // Direct formData bhej rahe hain (String format mein)
        }, 
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.status === 200) {
        navigate('/business-contact'); 
      }
    } catch (error) {
      console.error("Error saving company info:", error);
      // Optional: Error toast laga sakte ho
    }
  };

  return (
    <div className="p-10">
      <h2 className="text-2xl font-bold mb-6">Company Information</h2>
      <form onSubmit={handleNext} className="space-y-4">
        <input 
          name="companyName" 
          placeholder="Company Name" 
          onChange={handleChange} 
          className="w-full border p-2 rounded" 
          required 
        />
        <input 
          name="businessType" 
          placeholder="Business Type" 
          onChange={handleChange} 
          className="w-full border p-2 rounded" 
          required 
        />
        
        {/* User comma laga ke likh sakta hai, par ye jayega String banke hi */}
        <input 
          name="productCategory" 
          placeholder="Product Category (e.g. Seeds, Fertilizers)" 
          onChange={handleChange} 
          className="w-full border p-2 rounded" 
          required 
        />
        
        <input 
          name="established" 
          placeholder="Established Year" 
          onChange={handleChange} 
          className="w-full border p-2 rounded" 
          required 
        />
        <button type="submit" className="bg-red-600 text-white px-6 py-2 rounded">Next Step</button>
      </form>
    </div>
  );
};

export default CompanyInfo;