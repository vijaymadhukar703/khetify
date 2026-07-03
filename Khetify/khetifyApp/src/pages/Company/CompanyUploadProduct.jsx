import React, { useState } from 'react';
import axios from 'axios';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css'; 
import 'animate.css'; 
import config from "../../../config/config";
import { useNavigate } from 'react-router-dom';
import SelectWithOther from '../../Components/ims/SelectWithOther';

const CompanyUploadProduct = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    product_name: '',
    category: '',
    categoryOther: '',
    unit: '',
    description: '',
    sku: '',
    hsn: '',
    license_no: '',
    origin: 'India',
    mrp: '',
    cost_price: '',
    gst: '0',
    stock: '',
    moq: '',
    capacity: '', 
    packaging: '',
    bulk_type: '',
    bulk_custom_type: '',
    bulk_capacity: '',
    bulk_capacity_unit: 'units',
    dispatch_location: '',
    shelf_life: '',
    quality_grade: 'standard',
    storage_inst: '',
    handling_inst: '',
    isActive: true
  });

  const [selectedFiles, setSelectedFiles] = useState([]); 
  const [previews, setPreviews] = useState([]); 

  const handleInputChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleToggle = () => {
    setFormData(prev => ({ ...prev, isActive: !prev.isActive }));
  };

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length + selectedFiles.length > 5) {
      return Swal.fire({
        title: 'Limit Exceeded',
        text: 'You can only upload up to 5 images',
        icon: 'warning',
        confirmButtonColor: '#EA2831'
      });
    }
    setSelectedFiles(prev => [...prev, ...files]);
    const newPreviews = files.map(file => URL.createObjectURL(file));
    setPreviews(prev => [...prev, ...newPreviews]);
  };

  const removeImage = (index) => {
    const updatedFiles = selectedFiles.filter((_, i) => i !== index);
    const updatedPreviews = previews.filter((_, i) => i !== index);
    setSelectedFiles(updatedFiles);
    setPreviews(updatedPreviews);
  };

  const handleSubmit = async (e, uploadStatus = 'uploaded') => {
    if (e) e.preventDefault();
    setLoading(true);
    const companyId = localStorage.getItem("companyId");
    const token = localStorage.getItem("token");

    const data = new FormData();
    // 🔥 Mapping all fields to match Backend productModel.js
    data.append('companyId', companyId);
    data.append('productName', formData.product_name);
    data.append('category', formData.category === 'other' ? (formData.categoryOther || '').trim() : formData.category);
    data.append('unit', formData.unit);
    data.append('description', formData.description);
    data.append('skuNumber', formData.sku);
    data.append('hsnCode', formData.hsn);
    data.append('manufactureLicenseNo', formData.license_no);
    data.append('countryOrigin', formData.origin);
    data.append('mrp', formData.mrp);
    data.append('costPrice', formData.cost_price);
    data.append('gstPercentage', formData.gst);
    data.append('availableStock', formData.stock);
    data.append('minimumOrderQuantity', formData.moq);
    data.append('monthlyProductionCapacity', formData.capacity);
    data.append('packagingType', formData.packaging);
    data.append('bulkPackaging', JSON.stringify({
      type: formData.bulk_type === 'Other' ? (formData.bulk_custom_type || 'Other') : formData.bulk_type,
      customType: formData.bulk_type === 'Other' ? formData.bulk_custom_type : '',
      capacity: formData.bulk_capacity ? Number(formData.bulk_capacity) : undefined,
      capacityUnit: formData.bulk_capacity_unit || 'units',
    }));
    data.append('dispatchLocation', formData.dispatch_location);
    data.append('shelfLife', formData.shelf_life);
    data.append('qualityGrade', formData.quality_grade);
    data.append('storageInstructions', formData.storage_inst);
    data.append('safetyInstructions', formData.handling_inst);
    data.append('productStatus', formData.isActive ? 'active' : 'inactive');
    data.append('productUpload', uploadStatus === 'draft' ? 'saveDraft' : 'uploaded');
    
    selectedFiles.forEach((file) => data.append('productImages', file));

    try {
      const response = await axios.post(`${config.BASE_URL}product/create`, data, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      
      if (response.status === 201) {
        // 🔥 Professional Success Popup
        Swal.fire({
          title: 'Success!',
          text: 'Your product has been successfully uploaded.',
          icon: 'success',
          confirmButtonColor: '#EA2831',
          showClass: { popup: 'animate__animated animate__fadeInDown' }
        }).then((result) => { 
          // 🔥 OK click karne par catalog page par redirect
          if (result.isConfirmed) {
            navigate('/product-catalog'); 
          }
        });
      }
    } catch (error) {
      console.error("Upload Error:", error);
      Swal.fire({ 
        title: 'Upload Failed', 
        text: error.response?.data?.message || 'Internal Server Error', 
        icon: 'error', 
        confirmButtonColor: '#EA2831' 
      });
    } finally { 
      setLoading(false); 
    }
  };

  const inputClass = "w-full border border-stone-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#EA2831]/20 focus:border-[#EA2831] outline-none transition-all placeholder:text-stone-300 bg-white font-sora";

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50/30 font-sora">
      <div className="max-w-5xl mx-auto text-left">
        <form onSubmit={(e) => handleSubmit(e, 'uploaded')} className="space-y-10 bg-white p-6 sm:p-10 border border-stone-200 rounded-2xl shadow-sm mb-12 animate__animated animate__fadeIn">
          
          {/* Section 1: Basic Information */}
          <section>
            <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase tracking-wide">Basic Product Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-1">
                <label className="block text-sm font-semibold text-stone-700 mb-1.5">Product Name <span className="text-[#EA2831]">*</span></label>
                <input id="product_name" className={inputClass} value={formData.product_name} onChange={handleInputChange} placeholder="Enter full product name" required />
              </div>
              <div>
                <label className="block text-sm font-semibold text-stone-700 mb-1.5">Category <span className="text-[#EA2831]">*</span></label>
                <select id="category" className={inputClass} value={formData.category} onChange={handleInputChange} required>
                  <option value="">Select Category</option>
                  <option value="fertilizers">Fertilizers</option>
                  <option value="pesticides">Pesticides</option>
                  <option value="seeds">Seeds</option>
                  <option value="tools">Equipment & Tools</option>
                  <option value="growth_promoters">Growth Promoters</option>
                  <option value="other">Other…</option>
                </select>
                {formData.category === 'other' && (
                  <input
                    id="categoryOther"
                    className={`${inputClass} mt-2`}
                    value={formData.categoryOther}
                    onChange={handleInputChange}
                    placeholder="Enter category name"
                    required
                  />
                )}
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-stone-700 mb-1.5">Product Description</label>
                <textarea id="description" className={inputClass} value={formData.description} onChange={handleInputChange} placeholder="Provide features and benefits..." rows="3"></textarea>
              </div>
              <div>
                <label className="block text-sm font-semibold text-stone-700 mb-1.5">Unit of Measurement</label>
                <SelectWithOther
                  id="unit" className={inputClass} value={formData.unit}
                  onChange={(v) => setFormData(prev => ({ ...prev, unit: v }))}
                  placeholder="Select Unit" otherPlaceholder="Enter unit of measurement"
                  options={[
                    { value: 'Kilograms', label: 'Kilograms (kg)' },
                    { value: 'Grams', label: 'Grams (g)' },
                    { value: 'Liters', label: 'Liters (L)' },
                    { value: 'Milliliters', label: 'Milliliters (ml)' },
                    { value: 'Pieces', label: 'Pieces (Pcs)' },
                    { value: 'Packets', label: 'Packets (Pkt)' },
                    { value: 'Metric Ton', label: 'Metric Ton (MT)' },
                  ]}
                />
              </div>
            </div>
            
            {/* Image Upload Area */}
            <div className="mt-8">
              <label className="block text-sm font-semibold text-stone-700 mb-3">Product Images (Upload up to 5)</label>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="md:col-span-2 border-2 border-dashed border-stone-200 rounded-xl p-8 flex flex-col items-center justify-center bg-stone-50 hover:bg-stone-100 cursor-pointer min-h-[160px] relative transition-colors group">
                  <input type="file" multiple onChange={handleImageChange} className="absolute inset-0 opacity-0 cursor-pointer z-20" />
                  <span className="material-symbols-outlined text-stone-400 text-4xl group-hover:text-[#EA2831] transition-colors mb-2">cloud_upload</span>
                  <p className="text-sm font-medium text-stone-900">Drag & drop or <span className="text-[#EA2831] underline">browse</span></p>
                  <p className="text-[10px] text-stone-500 uppercase mt-1 font-bold">JPEG, PNG (MAX 5MB)</p>
                </div>
                {previews.map((src, index) => (
                  <div key={index} className="aspect-square rounded-xl border border-stone-200 overflow-hidden relative shadow-sm animate__animated animate__zoomIn">
                    <img src={src} className="w-full h-full object-cover" alt="preview" />
                    <button type="button" onClick={() => removeImage(index)} className="absolute top-1.5 right-1.5 bg-[#EA2831] text-white rounded-full p-1 shadow-md hover:bg-black transition-all">
                      <span className="material-symbols-outlined text-xs block font-bold">close</span>
                    </button>
                  </div>
                ))}
                {[...Array(Math.max(0, 3 - previews.length))].map((_, i) => (
                  <div key={`empty-${i}`} className="aspect-square bg-stone-50 rounded-xl border border-stone-200 border-dashed flex items-center justify-center text-stone-300">
                    <span className="material-symbols-outlined text-3xl">add</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Section 2: Identification */}
          <section>
            <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2">Identification & Traceability</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div><label className="block text-sm font-semibold text-stone-700 mb-1.5">SKU Code</label><input id="sku" className={inputClass} value={formData.sku} onChange={handleInputChange} placeholder="e.g., KHT-UREA-001" /></div>
              <div><label className="block text-sm font-semibold text-stone-700 mb-1.5">HSN Code</label><input id="hsn" className={inputClass} value={formData.hsn} onChange={handleInputChange} placeholder="e.g., 31021000" /></div>
              <div className="md:col-span-2"><label className="block text-sm font-semibold text-stone-700 mb-1.5">Manufacturer License No.</label><input id="license_no" className={inputClass} value={formData.license_no} onChange={handleInputChange} placeholder="e.g., MFG/LIC/2023/890" /></div>
              <div><label className="block text-sm font-semibold text-stone-700 mb-1.5">Country of Origin</label>
                <SelectWithOther
                  id="origin" className={inputClass} value={formData.origin}
                  onChange={(v) => setFormData(prev => ({ ...prev, origin: v }))}
                  otherPlaceholder="Enter country of origin"
                  options={['India', 'USA', 'Germany', 'Israel', 'China']}
                />
              </div>
            </div>
          </section>

          {/* Section 3: Pricing */}
          <section>
            <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase tracking-wide">Pricing & Tax</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div><label className="block text-sm font-semibold text-stone-700 mb-1.5">MRP (₹) <span className="text-[#EA2831]">*</span></label><input id="mrp" type="number" className={inputClass} value={formData.mrp} onChange={handleInputChange} placeholder="0.00" required /></div>
              <div>
                <label className="block text-sm font-semibold text-stone-700 mb-1.5 flex justify-between">Cost Price (₹) <span className="text-[#EA2831]">*</span> <span className="text-[9px] bg-stone-100 px-1.5 py-0.5 rounded border border-stone-200 text-stone-500 font-bold uppercase">INTERNAL ONLY</span></label>
                <input id="cost_price" type="number" className={inputClass} value={formData.cost_price} onChange={handleInputChange} placeholder="0.00" required />
              </div>
              <div><label className="block text-sm font-semibold text-stone-700 mb-1.5">GST (%)</label>
                <select id="gst" className={inputClass} value={formData.gst} onChange={handleInputChange}>
                  <option value="0">0% (Exempt)</option>
                  <option value="5">5%</option>
                  <option value="12">12%</option>
                  <option value="18">18%</option>
                  <option value="28">28%</option>
                </select>
              </div>
            </div>
          </section>

          {/* Section 4: Supply & Logistics */}
          <section>
            <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase tracking-wide">Supply & Logistics</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div><label className="block text-sm font-semibold text-stone-700 mb-1.5">Available Stock <span className="text-[#EA2831]">*</span></label><input id="stock" type="number" className={inputClass} value={formData.stock} onChange={handleInputChange} placeholder="e.g., 5000" required /></div>
              <div><label className="block text-sm font-semibold text-stone-700 mb-1.5">Minimum Order Quantity (MOQ)</label><input id="moq" type="number" className={inputClass} value={formData.moq} onChange={handleInputChange} placeholder="e.g., 10" /></div>
              <div><label className="block text-sm font-semibold text-stone-700 mb-1.5">Monthly Production Capacity</label><input id="capacity" className={inputClass} value={formData.capacity} onChange={handleInputChange} placeholder="e.g., 20000 Units" /></div>
              <div><label className="block text-sm font-semibold text-stone-700 mb-1.5">Packaging Type</label>
                <SelectWithOther
                  id="packaging" className={inputClass} value={formData.packaging}
                  onChange={(v) => setFormData(prev => ({ ...prev, packaging: v }))}
                  placeholder="Select Packaging" otherPlaceholder="Enter packaging type"
                  options={['HDPE Bag', 'Jute Bag', 'Bottle', 'Drum', 'Carton Box', 'Pouch', 'Sachet', 'Tin/Can', 'Bulk Container']}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-stone-700 mb-1.5">Bulk Packaging Type</label>
                <select id="bulk_type" className={inputClass} value={formData.bulk_type} onChange={handleInputChange}>
                  <option value="">Select Bulk Packaging</option>
                  <option value="Carton">Carton</option>
                  <option value="Bag">Bag</option>
                  <option value="Box">Box</option>
                  <option value="Sack">Sack</option>
                  <option value="Drum">Drum</option>
                  <option value="Other">Other…</option>
                </select>
                {formData.bulk_type === 'Other' && (
                  <input
                    id="bulk_custom_type"
                    className={`${inputClass} mt-2`}
                    value={formData.bulk_custom_type}
                    onChange={handleInputChange}
                    placeholder="Enter bulk packaging type"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-stone-700 mb-1.5">Capacity Per Package</label>
                <div className="flex gap-2">
                  <input
                    id="bulk_capacity"
                    type="number"
                    min="0"
                    className={inputClass}
                    value={formData.bulk_capacity}
                    onChange={handleInputChange}
                    placeholder="e.g., 50"
                  />
                  <input
                    id="bulk_capacity_unit"
                    className={`${inputClass} max-w-[120px]`}
                    value={formData.bulk_capacity_unit}
                    onChange={handleInputChange}
                    placeholder="units"
                  />
                </div>
                <p className="text-xs text-stone-400 mt-1">e.g. 1 Carton contains 50 units</p>
              </div>
              <div className="md:col-span-2"><label className="block text-sm font-semibold text-stone-700 mb-1.5">Dispatch Location</label><input id="dispatch_location" className={inputClass} value={formData.dispatch_location} onChange={handleInputChange} placeholder="City, State (e.g., Pune, Maharashtra)" /></div>
            </div>
          </section>

          {/* Section 5: Compliance & Validity */}
          <section>
            <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase tracking-wide">Compliance & Validity</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div><label className="block text-sm font-semibold text-stone-700 mb-1.5">Shelf Life</label><input id="shelf_life" className={inputClass} value={formData.shelf_life} onChange={handleInputChange} placeholder="e.g., 24 Months" /></div>
              <p className="text-xs text-stone-400 md:col-span-2">Manufacturing &amp; expiry dates are captured per lot when you receive stock.</p>
              <div><label className="block text-sm font-semibold text-stone-700 mb-1.5">Quality Grade</label>
                <SelectWithOther
                  id="quality_grade" className={inputClass} value={formData.quality_grade}
                  onChange={(v) => setFormData(prev => ({ ...prev, quality_grade: v }))}
                  otherPlaceholder="Enter quality grade"
                  options={[
                    { value: 'standard', label: 'Standard' },
                    { value: 'premium', label: 'Premium' },
                    { value: 'export', label: 'Export Quality' },
                    { value: 'commercial', label: 'Commercial Grade' },
                  ]}
                />
              </div>
            </div>
          </section>

          {/* Section 6: Storage & Handling */}
          <section>
            <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase tracking-wide">Storage & Handling</h3>
            <div className="grid grid-cols-1 gap-6">
              <div><label className="block text-sm font-semibold text-stone-700 mb-1.5">Storage Instructions</label>
                <SelectWithOther
                  id="storage_inst" className={inputClass} value={formData.storage_inst}
                  onChange={(v) => setFormData(prev => ({ ...prev, storage_inst: v }))}
                  placeholder="Select Storage Condition" otherPlaceholder="Enter storage condition"
                  options={[
                    { value: 'cool_dry', label: 'Cool & Dry Place' },
                    { value: 'refrigerated', label: 'Refrigerated (2-8°C)' },
                    { value: 'frozen', label: 'Frozen (Below 0°C)' },
                    { value: 'room_temp', label: 'Room Temperature' },
                    { value: 'ventilated', label: 'Well Ventilated Area' },
                    { value: 'hazmat', label: 'Hazardous Material Storage' },
                  ]}
                />
              </div>
              <div><label className="block text-sm font-semibold text-stone-700 mb-1.5">Handling & Safety Instructions</label><textarea id="handling_inst" className={inputClass} value={formData.handling_inst} onChange={handleInputChange} rows="2" placeholder="e.g., Use gloves..."></textarea></div>
            </div>
          </section>

          {/* Status Toggle */}
          <section className="flex items-center justify-between py-6 border-t border-stone-100">
            <div><h3 className="font-bold text-stone-900">Product Status</h3><p className="text-sm text-stone-500">Active products appear in the catalog.</p></div>
            <div className="flex items-center gap-3">
              <span className={`text-[11px] font-black tracking-widest ${formData.isActive ? 'text-[#EA2831]' : 'text-stone-400'}`}>{formData.isActive ? 'ACTIVE' : 'INACTIVE'}</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={formData.isActive} onChange={handleToggle} className="sr-only peer" />
                <div className="w-11 h-6 bg-stone-200 rounded-full peer peer-checked:bg-[#EA2831] after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
              </label>
            </div>
          </section>

          {/* Buttons */}
          <div className="flex justify-end gap-4 border-t border-stone-100 pt-8">
            <button type="button" onClick={(e) => handleSubmit(e, 'draft')} className="px-6 py-2.5 text-sm font-bold border border-stone-200 rounded-xl hover:bg-stone-50 transition-all">Save as Draft</button>
            <button type="submit" disabled={loading} className="px-10 py-2.5 text-sm font-bold bg-[#EA2831] text-white rounded-xl hover:bg-black shadow-lg shadow-[#EA2831]/20 active:scale-[0.98] transition-all">
              {loading ? 'Processing...' : 'Upload Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CompanyUploadProduct;