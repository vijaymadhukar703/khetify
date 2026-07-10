import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import TopNav from './TopNav';
import Sidebar from './Sidebar';
import NotificationBell from './ims/NotificationBell';
import { MODULES, activeModule } from '../lib/nav';
import { useSubscription, FEATURES } from '../context/SubscriptionContext';
import { usePermission } from '../context/PermissionContext';
import { disconnectSocket } from '../lib/socket';
import { getCompany } from '../lib/imsApi';
import SupportChatWidget from './support/SupportChatWidget';

// Company breadcrumb: resolve the active module for the current path.
const resolveCompanyCrumb = (pathname) => {
  const m = activeModule(pathname);
  return m ? { icon: m.icon, title: m.title } : null;
};

// Shell: a slim full-width TopNav over a collapsible left Sidebar + page
// content. The Sidebar mirrors the Hub's module cards so the same destinations
// are reachable from any screen; it expands/compresses on desktop and slides in
// as a drawer on mobile. The company nav config (entries + profile menu) is
// built here and passed to the SHARED TopNav/Sidebar (the seller portal renders
// through the very same components with its own config).
const DashboardLayout = () => {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const { has, plan, loading: subLoading } = useSubscription();
  const { can, loading: permLoading } = usePermission();

  // The company must be approved before the module sidebar is usable. Until then
  // we hide the Sidebar entirely and let the page (Hub) show its under-review
  // message, so an un-approved company can't navigate into gated modules.
  const companyId = localStorage.getItem('companyId');
  const [approved, setApproved] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!companyId) return;
    getCompany(companyId)
      .then((c) => { if (alive) setApproved(c?.status === 'approved'); })
      .catch(() => {});
    return () => { alive = false; };
  }, [companyId]);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      localStorage.setItem('sidebarCollapsed', c ? '0' : '1');
      return !c;
    });

  // Same gating as the Hub: HIDE on capability (RBAC), LOCK on subscription.
  const imsActive = !subLoading && !!plan && plan !== 'free';
  const visible = (m) => !(m.capability && !permLoading && !can(m.capability));
  const locked = (m) => {
    if (m.feature === 'ims') return !imsActive;
    if (m.feature === FEATURES.API_ACCESS) return !has(FEATURES.API_ACCESS);
    return false;
  };
  const entries = [
    { to: '/hub', icon: 'home', title: 'Home', end: true },
    ...MODULES.filter(visible).map((m) => ({
      to: m.path, icon: m.icon, title: m.title, isLocked: locked(m), lockTitle: 'Upgrade to unlock',
    })),
    // Help resources — always available, no gating.
    { to: '/faq', icon: 'quiz', title: 'FAQ' },
  ];

  const userName = localStorage.getItem('userName') || 'User';
  const logout = () => {
    disconnectSocket();
    localStorage.clear();
    navigate('/login', { replace: true });
  };
  const profile = {
    name: userName,
    menuItems: [
      { icon: 'person', label: 'Profile', onClick: () => navigate('/profile') },
      // Administration + Settings only once the company is approved; an
      // un-approved company gets Profile + Logout only.
      ...(approved
        ? [
            { icon: 'apps', label: 'Administration', onClick: () => navigate('/admin') },
            { icon: 'settings', label: 'Settings', onClick: () => navigate('/settings') },
          ]
        : []),
      { divider: true },
      { icon: 'logout', label: 'Logout', danger: true, onClick: logout },
    ],
  };

  return (
    <div className="flex flex-col h-screen bg-stone-50 font-sora overflow-hidden text-stone-900">
      <TopNav
        onMenuClick={() => setMobileOpen(true)}
        brand={{ label: 'Khetify' }}
        homePath="/hub"
        resolveCrumb={resolveCompanyCrumb}
        Bell={NotificationBell}
        profile={profile}
      />
      <div className="flex flex-1 overflow-hidden">
        {approved && (
          <Sidebar
            collapsed={collapsed}
            onToggle={toggleCollapsed}
            mobileOpen={mobileOpen}
            onMobileClose={() => setMobileOpen(false)}
            entries={entries}
            onLocked={() => navigate('/billing')}
          />
        )}
        {/* overflow-x-hidden stops a stray wide element from scrolling the whole
            page sideways on mobile; data tables keep their own scroll wrappers. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
      {/* Floating company↔support chat — reachable from every dashboard screen. */}
      <SupportChatWidget />
    </div>
  );
};

export default DashboardLayout;
