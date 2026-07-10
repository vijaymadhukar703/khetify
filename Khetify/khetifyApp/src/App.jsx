import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// 🔥 IMS: subscription feature-gating provider
import { SubscriptionProvider } from './context/SubscriptionContext';
// 🔥 RBAC: role/capability provider (drives usePermission + <Can>)
import { PermissionProvider } from './context/PermissionContext';
// 🔥 RBAC: page-level protection for role-gated routes
import RequireCap from './Components/ims/RequireCap';
import ErrorBoundary from './Components/ErrorBoundary';

// 1. Basic & Marketing Pages
import About from './pages/About';
import CompanyAbout from './pages/Company/CompanyAbout';
import CompanyRegister from './pages/Company/CompanyRegister';
// CompanyLogin hataya gaya
import CompanyRegisterSuccess from './pages/Company/CompanyRegisterSuccess';

// 2. Onboarding Steps (Steps 1 to 5)
import CompanySetup from './pages/Company/CompanySetup';
import CompanySetupStep2 from './pages/Company/CompanySetupStep2';
import CompanySetupStep3 from './pages/Company/CompanySetupStep3';
import CompanySetupStep4 from './pages/Company/CompanySetupStep4';
import CompanySetupStep5 from './pages/Company/CompanySetupStep5';
import CompanySubmissionComplete from './pages/Company/CompanySubmissionComplete';
import CompanyApprovalSuccess from './pages/Company/CompanyApprovalSuccess';

// 3. Dashboard Layout & Pages
import DashboardLayout from './Components/DashboardLayout';
import CompanyDashboard from './pages/Company/CompanyDashboard';
import CompanyUploadProduct from './pages/Company/CompanyUploadProduct';
import CompanyProductCatalog from './pages/Company/CompanyProductCatalog';
import CompanyReturns from './pages/Company/CompanyReturns';
import CompanySupport from './pages/Company/CompanySupport';
import CompanyFaq from './pages/Company/CompanyFaq';
import CompanyOrders from './pages/Company/CompanyOrders';

// 🔥 IMS: subscription / upgrade page
import Billing from './pages/Company/Billing';

// Edit Product Page Import
import CompanyEditProduct from './pages/Company/CompanyEditProduct';
import CompanyLogin from './pages/Company/CompanyLogin';
import CompanyForgotPassword from './pages/Company/CompanyForgotPassword';
import CompanyResetPassword from './pages/Company/CompanyResetPassword';

import ImsWarehouses from './pages/Company/ims/ImsWarehouses';
import DriverApp from './pages/Driver/DriverApp';
import ImsLabels from './pages/Company/ims/ImsLabels';
import ImsCustomers from './pages/Company/ims/ImsCustomers';
import ImsAnalytics from './pages/Company/ims/ImsAnalytics';
import ImsPurchasing from './pages/Company/ims/ImsPurchasing';
import CompanyNotifications from './pages/Company/CompanyNotifications';
import CompanyUsers from './pages/Company/CompanyUsers';
import CompanySettings from './pages/Company/CompanySettings';
import CompanyProfile from './pages/Company/CompanyProfile';
import CompanySellers from './pages/Company/CompanySellers';
import CompanySupplyRequests from './pages/Company/CompanySupplyRequests';
import CompanyPcApplications from './pages/Company/CompanyPcApplications';

// New card-based navigation + merged modules
import Hub from './pages/Company/Hub';
import Administration from './pages/Company/Administration';
import OrderHistory from './pages/Company/OrderHistory';
import InventoryTracking from './pages/Company/ims/InventoryTracking';
import Operations from './pages/Company/ims/Operations';

// 🔥 Seller-side IMS portal (Phase 1: auth + shell). Self-contained under
//    /seller/*; does not touch company routes or contexts.
import SellerLayout from './Components/seller/SellerLayout';
import RequireSeller from './Components/seller/RequireSeller';
import SellerAbout from './pages/seller/SellerAbout';
import SellerRegister from './pages/seller/SellerRegister';
import SellerLogin from './pages/seller/SellerLogin';
import SellerOnboarding from './pages/seller/SellerOnboarding';
import SellerHub from './pages/seller/SellerHub';
import SellerCompanies from './pages/seller/SellerCompanies';
import SellerCertifications from './pages/seller/SellerCertifications';
import SellerWarehouses from './pages/seller/SellerWarehouses';
import SellerProductCatalog from './pages/seller/SellerProductCatalog';
import SellerListings from './pages/seller/SellerListings';
import SellerSupply from './pages/seller/SellerSupply';
import SellerInventory from './pages/seller/SellerInventory';
import SellerOperations from './pages/seller/SellerOperations';
import SellerDashboard from './pages/seller/SellerDashboard';
import SellerAnalytics from './pages/seller/SellerAnalytics';
import SellerLabels from './pages/seller/SellerLabels';
import SellerCustomers from './pages/seller/SellerCustomers';
import SellerOutbound from './pages/seller/SellerOutbound';
import SellerBilling from './pages/seller/SellerBilling';
import SellerTeam from './pages/seller/SellerTeam';
import SellerAdministration from './pages/seller/SellerAdministration';
import SellerProfile from './pages/seller/SellerProfile';
import SellerFaq from './pages/seller/SellerFaq';
import { SellerSubscriptionProvider } from './context/SellerSubscriptionContext';
import { SellerPermissionProvider } from './context/SellerPermissionContext';

// 🔐 Platform admin panel (/admin/*): company review + approval. Self-contained,
//    own token ("adminToken") + guard; does not touch company/seller flows.
import RequireAdmin from './Components/admin/RequireAdmin';
import AdminLayout from './Components/admin/AdminLayout';
import AdminLogin from './pages/admin/AdminLogin';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminCompanies from './pages/admin/AdminCompanies';
import AdminCompanyDetail from './pages/admin/AdminCompanyDetail';
import AdminSupportChats from './pages/admin/AdminSupportChats';
import AdminPlaceholder from './pages/admin/AdminPlaceholder';

// 🛒 Customer storefront (/customer-shop/*): public browse + guest cart +
//    consumer auth-at-checkout + COD. Fully self-contained (own providers +
//    token "shopToken"); does not touch company/seller/admin routes.
import { ShopAuthProvider } from './context/ShopAuthContext';
import { CartProvider } from './context/CartContext';
import ShopLayout from './Components/shop/ShopLayout';
import RequireConsumer from './Components/shop/RequireConsumer';
import ShopHome from './pages/shop/ShopHome';
import ShopProducts from './pages/shop/ShopProducts';
import ShopProductDetail from './pages/shop/ShopProductDetail';
import ShopCart from './pages/shop/ShopCart';
import ShopLogin from './pages/shop/ShopLogin';
import ShopCheckout from './pages/shop/ShopCheckout';
import ShopOrderSuccess from './pages/shop/ShopOrderSuccess';
import ShopOrders from './pages/shop/ShopOrders';

function App() {
  return (
    // 🔥 IMS: wraps the whole app so any page can read the plan via useSubscription()
    //         and the role/capabilities via usePermission()
    <SubscriptionProvider>
      <PermissionProvider>
      <ErrorBoundary>
      <Routes>
        {/* Default Path Redirect -> About Page */}
        <Route path="/" element={<Navigate to="/about" replace />} />

        {/* Driver mobile app (standalone, phone + PIN login) */}
        <Route path="/driver" element={<DriverApp />} />

        {/* Auth & Marketing Routes */}
        <Route path="/about" element={<About />} />
        <Route path="/company-about" element={<CompanyAbout />} />
        <Route path="/seller-about" element={<SellerAbout />} />
        <Route path="/register" element={<CompanyRegister />} />
        <Route path="/login" element={<CompanyLogin />} />
        <Route path="/forgot-password" element={<CompanyForgotPassword />} />
        <Route path="/reset-password" element={<CompanyResetPassword />} />

        <Route path="/success" element={<CompanyRegisterSuccess />} />

        {/* Onboarding Flow */}
        <Route path="/company-setup" element={<CompanySetup />} />
        <Route path="/company-info" element={<CompanySetupStep2 />} />
        <Route path="/company-contact" element={<CompanySetupStep3 />} />
        <Route path="/company-verification" element={<CompanySetupStep4 />} />
        <Route path="/company-final" element={<CompanySetupStep5 />} />

        {/* Post-Submission Screens */}
        <Route
          path="/submission-complete"
          element={<CompanySubmissionComplete />}
        />
        <Route path="/approval-success" element={<CompanyApprovalSuccess />} />

        {/* Main Dashboard Section with top-nav layout (card-based Hub is home) */}
        <Route element={<DashboardLayout />}>
          {/* Card launchpad — the new home */}
          <Route path="/hub" element={<Hub />} />

          {/* The single unified dashboard */}
          <Route path="/company-dashboard" element={<CompanyDashboard />} />

          {/* Inventory Tracking (merged: stock + lots + batches + numbering) */}
          <Route path="/inventory" element={<RequireCap capability="inventory:read" ims><InventoryTracking /></RequireCap>} />

          {/* Warehouses (card → profile) */}
          <Route path="/warehouses" element={<RequireCap capability="location:read" ims><ImsWarehouses /></RequireCap>} />

          {/* Operations (merged: receive + send + transfers + tracking + trace) */}
          <Route path="/operations" element={<RequireCap capability="grn:read" ims><Operations /></RequireCap>} />

          {/* Orders + dedicated Order History */}
          <Route path="/orders" element={<RequireCap capability="order:read"><CompanyOrders /></RequireCap>} />
          <Route path="/order-history" element={<RequireCap capability="order:read"><OrderHistory /></RequireCap>} />

          {/* Analytics (folds in the old executive widgets) */}
          <Route path="/analytics" element={<RequireCap capability="report:read" ims><ImsAnalytics /></RequireCap>} />

          {/* Profile — registration details (identity, GSTIN/PAN, KYC docs) */}
          <Route path="/profile" element={<CompanyProfile />} />

          {/* Administration card hub */}
          <Route path="/admin" element={<Administration />} />

          {/* ── Administration leaf pages (reached from the Admin hub) ── */}
          <Route path="/upload-product" element={<RequireCap capability="product:manage"><CompanyUploadProduct /></RequireCap>} />
          <Route path="/product-catalog" element={<RequireCap capability="inventory:read"><CompanyProductCatalog /></RequireCap>} />
          <Route path="/ims/customers" element={<RequireCap capability="customer:read"><ImsCustomers /></RequireCap>} />
          <Route path="/ims/integrations" element={<Navigate to="/hub" replace />} />{/* Integrations / API keys removed */}
          <Route path="/ims/purchasing" element={<RequireCap capability="grn:read" ims><ImsPurchasing /></RequireCap>} />
          <Route path="/ims/labels" element={<RequireCap capability="lot:read" ims><ImsLabels /></RequireCap>} />
          {/* Vendors section removed — dealers live under Sellers. Redirect stale links. */}
          <Route path="/vendors" element={<Navigate to="/sellers" replace />} />
          <Route path="/sellers" element={<RequireCap capability="inventory:read"><CompanySellers /></RequireCap>} />
          <Route path="/supply-requests" element={<RequireCap capability="inventory:read"><CompanySupplyRequests /></RequireCap>} />
          <Route path="/pc-applications" element={<RequireCap capability="inventory:read"><CompanyPcApplications /></RequireCap>} />
          <Route path="/returns" element={<CompanyReturns />} />
          <Route path="/support" element={<CompanySupport />} />
          <Route path="/faq" element={<CompanyFaq />} />
          <Route path="/notifications" element={<CompanyNotifications />} />
          <Route path="/users" element={<RequireCap capability="user:read"><CompanyUsers /></RequireCap>} />
          <Route path="/settings" element={<RequireCap capability="company:settings"><CompanySettings /></RequireCap>} />
          <Route path="/billing" element={<RequireCap capability="billing:manage"><Billing /></RequireCap>} />
          <Route path="/edit-product/:productId" element={<RequireCap capability="product:manage"><CompanyEditProduct /></RequireCap>} />

          {/* ── Backwards-compatible redirects: old deep links → merged modules ── */}
          <Route path="/ims" element={<Navigate to="/inventory" replace />} />
          <Route path="/ims/lots" element={<Navigate to="/inventory?tab=lots" replace />} />
          <Route path="/ims/warehouses" element={<Navigate to="/warehouses" replace />} />
          <Route path="/ims/inbound" element={<Navigate to="/operations?tab=receive" replace />} />
          <Route path="/ims/outbound" element={<Navigate to="/operations?tab=send" replace />} />
          <Route path="/ims/transport" element={<Navigate to="/operations?tab=shipments" replace />} />
          <Route path="/ims/trace" element={<Navigate to="/operations?tab=trace" replace />} />
          <Route path="/ims/analytics" element={<Navigate to="/analytics" replace />} />
          <Route path="/ims/owner" element={<Navigate to="/analytics" replace />} />

          {/* ── Removed modules: Locations & Counts no longer exist ── */}
          <Route path="/ims/locations" element={<Navigate to="/hub" replace />} />
          <Route path="/ims/counts" element={<Navigate to="/hub" replace />} />
        </Route>

        {/* ───────────── Seller portal (/seller/*) ───────────── */}
        <Route path="/seller" element={<Navigate to="/seller/login" replace />} />
        <Route path="/seller/register" element={<SellerRegister />} />
        <Route path="/seller/login" element={<SellerLogin />} />
        <Route path="/seller/onboarding" element={<RequireSeller><SellerOnboarding /></RequireSeller>} />
        <Route element={<RequireSeller><SellerSubscriptionProvider><SellerPermissionProvider><SellerLayout /></SellerPermissionProvider></SellerSubscriptionProvider></RequireSeller>}>
          <Route path="/seller/hub" element={<SellerHub />} />
          <Route path="/seller/profile" element={<SellerProfile />} />
          <Route path="/seller/admin" element={<SellerAdministration />} />
          <Route path="/seller/dashboard" element={<SellerDashboard />} />
          <Route path="/seller/analytics" element={<SellerAnalytics />} />
          <Route path="/seller/companies" element={<SellerCompanies />} />
          <Route path="/seller/certifications" element={<SellerCertifications />} />
          <Route path="/seller/team" element={<SellerTeam />} />
          <Route path="/seller/warehouses" element={<SellerWarehouses />} />
          <Route path="/seller/products" element={<SellerProductCatalog />} />
          <Route path="/seller/listings" element={<SellerListings />} />
          <Route path="/seller/supply" element={<SellerSupply />} />
          <Route path="/seller/inventory" element={<SellerInventory />} />
          <Route path="/seller/operations" element={<SellerOperations />} />
          {/* Transfers now live inside the unified Operations module. */}
          <Route path="/seller/transfers" element={<Navigate to="/seller/operations?tab=shipments" replace />} />
          <Route path="/seller/labels" element={<SellerLabels />} />
          <Route path="/seller/customers" element={<SellerCustomers />} />
          <Route path="/seller/outbound" element={<SellerOutbound />} />
          <Route path="/seller/billing" element={<SellerBilling />} />
          <Route path="/seller/faq" element={<SellerFaq />} />
        </Route>

        {/* ───────────── Platform admin panel (/admin/*) ───────────── */}
        {/* NOTE: the company "Administration" hub lives at the EXACT path
            "/admin" (inside DashboardLayout above); these are "/admin/…" child
            paths, so there is no collision. */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/companies" element={<AdminCompanies />} />
          <Route path="/admin/companies/:id" element={<AdminCompanyDetail />} />
          <Route path="/admin/support" element={<AdminSupportChats />} />
          {/* UI-only sections + quick filters — present so navigation never breaks */}
          <Route path="/admin/sellers" element={<AdminPlaceholder title="Sellers" subtitle="Review and approve registered sellers." icon="storefront" />} />
          <Route path="/admin/pending" element={<Navigate to="/admin/companies?status=pending" replace />} />
          <Route path="/admin/approved" element={<Navigate to="/admin/companies?status=approved" replace />} />
          <Route path="/admin/rejected" element={<Navigate to="/admin/companies?status=rejected" replace />} />
          <Route path="/admin/profile" element={<AdminPlaceholder title="Profile" profile />} />
          {/* Bare /admin/* under the layout → dashboard */}
          <Route path="/admin/*" element={<Navigate to="/admin/dashboard" replace />} />
        </Route>

        {/* ───────────── Customer storefront (/customer-shop/*) ───────────── */}
        {/* Self-contained: own auth (shopToken) + guest cart. Public browse; */}
        {/* login is only required at checkout / orders (RequireConsumer).      */}
        <Route
          path="/customer-shop"
          element={
            <ShopAuthProvider>
              <CartProvider>
                <ShopLayout />
              </CartProvider>
            </ShopAuthProvider>
          }
        >
          <Route index element={<ShopHome />} />
          <Route path="products" element={<ShopProducts />} />
          <Route path="product/:listingId" element={<ShopProductDetail />} />
          <Route path="cart" element={<ShopCart />} />
          <Route path="login" element={<ShopLogin />} />
          <Route path="checkout" element={<RequireConsumer><ShopCheckout /></RequireConsumer>} />
          <Route path="order-success" element={<RequireConsumer><ShopOrderSuccess /></RequireConsumer>} />
          <Route path="orders" element={<RequireConsumer><ShopOrders /></RequireConsumer>} />
          {/* Unknown /customer-shop/* → storefront home */}
          <Route path="*" element={<Navigate to="/customer-shop" replace />} />
        </Route>

        {/* 404 Redirect -> Ab ye seedha Register pe bhejega, Login pe nahi */}
        <Route path="*" element={<Navigate to="/register" replace />} />
      </Routes>
      </ErrorBoundary>
      </PermissionProvider>
    </SubscriptionProvider>
  );
}

export default App;
