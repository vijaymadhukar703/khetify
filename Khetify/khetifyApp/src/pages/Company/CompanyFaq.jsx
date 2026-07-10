import React from 'react';
import FaqView from '../../Components/FaqView';
import { COMPANY_FAQ } from '../../lib/faqData';

// Company portal FAQ — reachable from the sidebar. Content lives in lib/faqData.js.
// To add videos: paste an embed URL (YouTube/Vimeo) or a direct .mp4 URL into
// `media.featured.embedUrl`, and set `demosHref` to your demo-videos page.
const CompanyFaq = () => (
  <FaqView
    title="Frequently Asked Questions"
    subtitle="Company portal se related aam sawaalon ke jawab — registration, inventory, orders, sellers, billing aur zyada."
    sections={COMPANY_FAQ}
    media={{
      featured: {
        title: 'Getting Started',
        description: 'Dekhiye kaise Khetify portal par company account banaye aur basic setup karein.',
        embedUrl: '', // ← apni video ka URL yahan paste karein
      },
      demosHref: '', // ← "View all demo videos" ka link yahan daalein
      help: {
        email: 'support@khetify.com',
        callHours: 'Mon–Sat, 10 AM–6 PM',
      },
      proTip: 'FAQ ko search ya category se filter karke aap jaldi sahi jawab tak pahunch sakte hain.',
    }}
  />
);

export default CompanyFaq;
