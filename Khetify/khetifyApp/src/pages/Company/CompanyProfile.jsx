import React, { useCallback, useEffect, useState } from 'react';
import ProfileView from '../../Components/ProfileView';
import { getCompanyProfile, updateCompanyProfile } from '../../lib/imsApi';

// Company Profile — registration details (identity, GSTIN/PAN, KYC documents)
// resolved from the verified token via GET /api/company/profile, editable via
// PATCH /api/company/profile. Renders through the shared ProfileView so it
// matches the seller profile exactly.
const CompanyProfile = () => {
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => getCompanyProfile()
    .then((r) => setModel(r?.data || null))
    .catch((e) => setError(e?.response?.data?.message || e.message || 'Something went wrong'))
    .finally(() => setLoading(false)), []);

  useEffect(() => { load(); }, [load]);

  // Save returns the updated profile so the page + completion bar refresh.
  const onSave = async (formData) => {
    const r = await updateCompanyProfile(formData);
    setModel(r?.data || null);
    return r;
  };

  return <ProfileView title="Company Profile" model={model} loading={loading} error={error} onSave={onSave} />;
};

export default CompanyProfile;
