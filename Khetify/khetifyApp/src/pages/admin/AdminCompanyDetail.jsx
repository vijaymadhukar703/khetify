import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { getAdminCompany, setAdminCompanyStatus } from '../../lib/adminApi';
import { StatusBadge, fmtDateTime } from '../../Components/admin/AdminUi';
import { fileHref } from '../../lib/fileHref';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });

// One label/value row inside a card.
const Row = ({ label, value }) => (
  <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-2">
    <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 sm:w-40 shrink-0 pt-0.5">{label}</span>
    <span className="text-sm text-stone-800 break-words">{value || '—'}</span>
  </div>
);

// Card wrapper with an icon header.
const Card = ({ icon, title, children }) => (
  <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-5">
    <div className="flex items-center gap-2 mb-3">
      <span className="material-symbols-outlined text-stone-400 text-[20px]">{icon}</span>
      <h2 className="text-sm font-bold text-stone-900">{title}</h2>
    </div>
    <div className="divide-y divide-stone-50">{children}</div>
  </div>
);

// One uploaded-document tile. Falls back to a clear "Document not uploaded"
// message when no file is present.
const DocTile = ({ label, number, url }) => {
  const href = fileHref(url);
  return (
    <div className="flex items-center justify-between gap-3 border border-stone-200 rounded-xl p-4">
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
        <p className="text-sm text-stone-800 truncate">{number || (href ? 'Document' : '—')}</p>
      </div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 border border-stone-200 hover:border-[#EA2831] hover:text-[#EA2831] text-stone-600 text-xs font-bold rounded-lg px-3 py-2 transition-colors shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">open_in_new</span> View
        </a>
      ) : (
        <span className="text-xs font-semibold text-stone-400 shrink-0">Document not uploaded</span>
      )}
    </div>
  );
};

const AdminCompanyDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getAdminCompany(id);
      setCompany(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load company');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const act = async (status) => {
    const label = status === 'approved' ? 'Approve' : 'Reject';
    const confirm = await Swal.fire({
      title: `${label} this company?`,
      text: status === 'approved'
        ? 'The company will get access to its dashboard.'
        : 'The company will be marked as rejected.',
      icon: status === 'approved' ? 'question' : 'warning',
      showCancelButton: true,
      confirmButtonText: label,
      confirmButtonColor: status === 'approved' ? '#16a34a' : '#dc2626',
      cancelButtonColor: '#78716c',
    });
    if (!confirm.isConfirmed) return;

    setActing(true);
    try {
      const res = await setAdminCompanyStatus(id, status);
      setCompany((c) => ({ ...c, status: res.data.status }));
      toast('success', res.message || `Company ${status}`);
    } catch (err) {
      toast('error', err.response?.data?.message || 'Action failed');
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return <div className="max-w-6xl mx-auto px-4 sm:px-8 py-16 text-center text-sm text-stone-400">Loading…</div>;
  }
  if (error || !company) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-10">
        <button onClick={() => navigate('/admin/companies')} className="inline-flex items-center gap-1.5 text-stone-600 hover:text-stone-900 text-sm font-semibold mb-6">
          <span className="material-symbols-outlined text-[20px]">arrow_back</span> Back
        </button>
        <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">{error || 'Company not found'}</div>
      </div>
    );
  }

  const isPending = company.status === 'pending';
  const docs = company.documents || {};

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
      <button onClick={() => navigate('/admin/companies')} className="inline-flex items-center gap-1.5 text-stone-600 hover:text-stone-900 text-sm font-semibold mb-5">
        <span className="material-symbols-outlined text-[20px]">arrow_back</span> Back
      </button>

      {/* Header */}
      <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-5 mb-6 border-t-4 border-t-[#EA2831]">
        <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <div className="h-14 w-14 rounded-xl bg-stone-50 border border-stone-100 flex items-center justify-center text-stone-400 shrink-0">
              <span className="material-symbols-outlined">apartment</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-stone-900 truncate">{company.companyName || company.fullName || 'Company'}</h1>
                <StatusBadge status={company.status} />
              </div>
              <p className="text-sm text-stone-500">
                {company.businessType || '—'}{company.companyName && company.fullName ? ` · ${company.fullName}` : ''}
              </p>
              <p className="text-xs text-stone-400 mt-0.5">Registered {fmtDateTime(company.submittedAt)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => act('approved')}
              disabled={!isPending || acting}
              className="inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg px-4 py-2.5 transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">check_circle</span> Approve
            </button>
            <button
              onClick={() => act('rejected')}
              disabled={!isPending || acting}
              className="inline-flex items-center gap-1.5 bg-[#EA2831] hover:bg-[#c91e26] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg px-4 py-2.5 transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">cancel</span> Reject
            </button>
          </div>
        </div>
        {!isPending && (
          <p className="mt-3 text-xs text-stone-400">
            This company is already <span className="font-semibold">{company.status}</span> — no further action needed.
          </p>
        )}
      </div>

      {/* Detail cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card icon="badge" title="Basic Information">
          <Row label="Full name" value={company.fullName} />
          <Row label="Email" value={company.email} />
          <Row label="Subscription" value={company.subscription} />
        </Card>

        <Card icon="business_center" title="Company Profile">
          <Row label="Company name" value={company.companyName} />
          <Row label="Business type" value={company.businessType} />
        </Card>

        <Card icon="contacts" title="Business Contact">
          <Row label="Authorized person" value={company.authorizedPerson} />
          <Row label="Business email" value={company.businessEmail} />
          <Row label="Address" value={company.address} />
        </Card>

        <Card icon="verified_user" title="Verification & KYC">
          <Row label="GSTIN" value={company.gstin} />
          <Row label="PAN" value={company.pan} />
        </Card>
      </div>

      {/* Uploaded documents */}
      <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-5 mt-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-stone-400 text-[20px]">folder</span>
          <h2 className="text-sm font-bold text-stone-900">Uploaded documents</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <DocTile label="GST Certificate" number={docs.gstCertificate?.number} url={docs.gstCertificate?.url} />
          <DocTile label="PAN" number={docs.pan?.number} url={docs.pan?.url} />
          <DocTile label="Udyam / Incorporation" number={docs.udyam?.number} url={docs.udyam?.url} />
        </div>
      </div>
    </div>
  );
};

export default AdminCompanyDetail;
