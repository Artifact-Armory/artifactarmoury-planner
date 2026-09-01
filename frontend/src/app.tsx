import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useAuthStore } from './store/authStore';
import { useTaxStore } from './store/taxStore';
import { useInviteGateStore } from './store/inviteGateStore';
import { authApi } from './api/endpoints/auth';
import { Toaster } from 'react-hot-toast';
import InviteGate from './components/common/InviteGate';

// Layouts
import MainLayout from './components/layout/MainLayout';
import DashboardLayout from './components/layout/DashboardLayout';

// Auth Components
import ProtectedRoute from './components/auth/ProtectedRoute';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import VerifyEmail from './pages/auth/VerifyEmail';

// Public Pages
import Home from './pages/Home';
import Browse from './pages/Browse';
import ModelDetails from './pages/ModelDetails';
import ArtistProfile from './pages/ArtistProfile';
import ArtistsList from './pages/ArtistsList';
import Category from './pages/Category';
import Tag from './pages/Tag';
import PublicTables from './pages/PublicTables';
import Contact from './pages/Contact';
import About from './pages/About';
import CreatorProtection from './pages/CreatorProtection';
import NotFound from './pages/NotFound';
import PrivacyPolicy from './pages/legal/PrivacyPolicy';
import TermsOfService from './pages/legal/TermsOfService';
import Checkout from './pages/Checkout';
import GlobalLibrary from './pages/GlobalLibrary';
import TableLibrary from './pages/TableLibrary';
import BundleDetails from './pages/BundleDetails';
import Bundles from './pages/Bundles';

// User Dashboard Pages
import Dashboard from './pages/dashboard/Dashboard';
import PurchaseHistory from './pages/dashboard/PurchaseHistory';
import MyDownloads from './pages/dashboard/MyDownloads';
import MyModels from './pages/dashboard/MyModels';
import Wishlist from './pages/dashboard/Wishlist';
import UserProfile from './pages/dashboard/UserProfile';
import SecuritySettings from './pages/dashboard/SecuritySettings';
import MyTables from './pages/dashboard/MyTables';
import Following from './pages/dashboard/Following';
import EditTable from './pages/dashboard/EditTable';
import Messages from './pages/dashboard/Messages';

// Artist Pages
import ArtistDashboard from './pages/artist/ArtistDashboard';
import ArtistModels from './pages/artist/ArtistModels';
import ArtistBundles from './pages/artist/ArtistBundles';
import ArtistReleases from './pages/artist/ArtistReleases';
import EditRelease from './pages/artist/EditRelease';
import ArtistShowcases from './pages/artist/ArtistShowcases';
import ArtistCollaborations from './pages/artist/ArtistCollaborations';
import CreateBundle from './pages/artist/CreateBundle';
import EditBundle from './pages/artist/EditBundle';
import CreateModel from './pages/artist/CreateModel';
import EditModel from './pages/artist/EditModel';
import ArtistPromotions from './pages/artist/ArtistPromotions';
import SalesDetail from './pages/artist/analytics/SalesDetail';
import ProductsDetail from './pages/artist/analytics/ProductsDetail';
import RatingDetail from './pages/artist/analytics/RatingDetail';
import SearchesDetail from './pages/artist/analytics/SearchesDetail';
import ModelFunnel from './pages/artist/analytics/ModelFunnel';
import ArtistSettings from './pages/artist/ArtistSettings';
import ArtistApplication from './pages/artist/ArtistApplication';
import ArtistPayouts from './pages/artist/ArtistPayouts';
import ArtistReports from './pages/artist/ArtistReports';

// Admin Pages
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminUsers from './pages/admin/AdminUsers';
import AdminModels from './pages/admin/AdminModels';
import AdminOrders from './pages/admin/AdminOrders';
import AdminCategories from './pages/admin/AdminCategories';
import AdminTags from './pages/admin/AdminTags';
import AdminArtistApplications from './pages/admin/AdminArtistApplications';
import AdminReports from './pages/admin/AdminReports';
import AdminModeration from './pages/admin/AdminModeration';
import AdminMessages from './pages/admin/AdminMessages';
import AdminMessageReports from './pages/admin/AdminMessageReports';
import AdminContactMessages from './pages/admin/AdminContactMessages';

// Planner
import Planner from './pages/Planner';

// Error Boundary
import ErrorBoundary from './components/common/ErrorBoundary';

// Legacy /tables/:id (the old flat "shop the look" page) now opens the
// read-only 3D table view in the planner.
function TableRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/planner/view/${id}`} replace />;
}

// Create QueryClient
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  const { setUser, setLoading, isAuthenticated, token, clearAuth } = useAuthStore();
  const loadTaxCountries = useTaxStore((s) => s.loadCountries);
  // Private/invite-only period: signed-in users bypass automatically, everyone
  // else needs a code (remembered on this device thereafter). See InviteGate.
  const inviteUnlocked = useInviteGateStore((s) => s.unlocked);
  const gateOpen = !isAuthenticated && !inviteUnlocked;

  // VAT rates drive every price on the storefront, so fetch them once at boot rather
  // than per page — a product card must be able to render its gross price straight
  // away. `loadCountries` no-ops if it has already run.
  useEffect(() => { loadTaxCountries(); }, [loadTaxCountries]);

  // Fetch user profile if authenticated
  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!token || !isAuthenticated) {
        return;
      }

      try {
        setLoading(true);
        const user = await authApi.getProfile();
        setUser(user);
      } catch (error) {
        console.error('Error fetching user profile:', error);
        clearAuth();
      } finally {
        setLoading(false);
      }
    };

    fetchUserProfile();
  }, [token, isAuthenticated, setUser, setLoading, clearAuth]);

  useEffect(() => {
    const handleExternalLogout = () => {
      clearAuth();
    };

    window.addEventListener('terrain_builder_logout', handleExternalLogout);
    return () => window.removeEventListener('terrain_builder_logout', handleExternalLogout);
  }, [clearAuth]);

  if (gateOpen) {
    return (
      <ErrorBoundary>
        <InviteGate />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Toaster
            position="top-center"
            toastOptions={{
              duration: 5000,
              style: {
                background: 'var(--popover)',
                color: 'var(--popover-foreground)',
                border: '1px solid var(--border)',
              },
              success: {
                iconTheme: {
                  primary: '#10B981',
                  secondary: 'var(--popover)',
                },
              },
              error: {
                iconTheme: {
                  primary: 'var(--destructive)',
                  secondary: 'var(--popover)',
                },
              },
            }}
          />
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<MainLayout />}>
              <Route index element={<Home />} />
              <Route path="browse" element={<Browse />} />
              <Route path="bundles" element={<Bundles />} />
              <Route path="models/:id" element={<ModelDetails />} />
              <Route path="bundles/:id" element={<BundleDetails />} />
              <Route path="artists" element={<ArtistsList />} />
              <Route path="artists/:id" element={<ArtistProfile />} />
              <Route path="categories/:id" element={<Category />} />
              <Route path="tags/:id" element={<Tag />} />
              <Route path="tables" element={<PublicTables />} />
              {/* Old showcase URL now opens the read-only 3D table view. */}
              <Route path="tables/:id" element={<TableRedirect />} />
              <Route path="about" element={<About />} />
              <Route path="contact" element={<Contact />} />
              <Route path="creator-protection" element={<CreatorProtection />} />
              <Route path="privacy-policy" element={<PrivacyPolicy />} />
              <Route path="terms-of-service" element={<TermsOfService />} />
              
              {/* Auth Routes */}
              <Route path="login" element={<Login />} />
              <Route path="register" element={<Register />} />
              <Route path="forgot-password" element={<ForgotPassword />} />
              <Route path="reset-password" element={<ResetPassword />} />
              <Route path="verify-email" element={<VerifyEmail />} />
              
              {/* Checkout */}
              <Route 
                path="checkout" 
                element={
                  <ProtectedRoute>
                    <Checkout />
                  </ProtectedRoute>
                } 
              />
            </Route>

            <Route path="/library/browse/:tableId" element={<GlobalLibrary />} />
            <Route path="/library/manage/:tableId" element={<TableLibrary />} />

            {/* User Dashboard Routes */}
            <Route 
              path="/dashboard" 
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="downloads" element={<MyDownloads />} />
              <Route path="models" element={<MyModels />} />
              <Route path="purchases" element={<PurchaseHistory />} />
              <Route path="wishlist" element={<Wishlist />} />
              <Route path="following" element={<Following />} />
              <Route path="messages" element={<Messages />} />
              <Route path="profile" element={<UserProfile />} />
              <Route path="security" element={<SecuritySettings />} />
              <Route path="tables" element={<MyTables />} />
              <Route path="tables/new" element={<EditTable />} />
              <Route path="tables/:id/edit" element={<EditTable />} />
            </Route>

            {/* Artist Routes */}
            <Route 
              path="/artist" 
              element={
                <ProtectedRoute requiredRole="artist">
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<ArtistDashboard />} />
              <Route path="models" element={<ArtistModels />} />
              <Route path="models/new" element={<CreateModel />} />
              <Route path="models/:id/edit" element={<EditModel />} />
              <Route path="bundles" element={<ArtistBundles />} />
              <Route path="bundles/new" element={<CreateBundle />} />
              <Route path="bundles/:id/edit" element={<EditBundle />} />
              <Route path="releases" element={<ArtistReleases />} />
              <Route path="releases/:id" element={<EditRelease />} />
              <Route path="showcases" element={<ArtistShowcases />} />
              <Route path="collaborations" element={<ArtistCollaborations />} />
              {/* Sales & Analytics merged into the Sales Overview (dashboard root). */}
              <Route path="sales" element={<Navigate to="/artist" replace />} />
              <Route path="promotions" element={<ArtistPromotions />} />
              <Route path="payouts" element={<ArtistPayouts />} />
              <Route path="reports" element={<ArtistReports />} />
              <Route path="analytics/sales" element={<SalesDetail />} />
              <Route path="analytics/products" element={<ProductsDetail />} />
              <Route path="analytics/rating" element={<RatingDetail />} />
              <Route path="analytics/searches" element={<SearchesDetail />} />
              <Route path="analytics/model/:id" element={<ModelFunnel />} />
              <Route path="settings" element={<ArtistSettings />} />
            </Route>

            {/* Artist Application */}
            <Route 
              path="/apply-artist" 
              element={
                <ProtectedRoute>
                  <MainLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<ArtistApplication />} />
            </Route>

            {/* Admin Routes */}
            <Route 
              path="/admin" 
              element={
                <ProtectedRoute requiredRole="admin">
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<AdminDashboard />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="models" element={<AdminModels />} />
              <Route path="orders" element={<AdminOrders />} />
              <Route path="categories" element={<AdminCategories />} />
              <Route path="tags" element={<AdminTags />} />
              <Route path="artist-applications" element={<AdminArtistApplications />} />
              <Route path="moderation" element={<AdminModeration />} />
              <Route path="messages" element={<AdminMessages />} />
              <Route path="message-reports" element={<AdminMessageReports />} />
              <Route path="contact" element={<AdminContactMessages />} />
              <Route path="reports" element={<AdminReports />} />
            </Route>

            {/* Table Planner — full-screen, no layout wrapper, open to guests */}
            <Route path="planner" element={<Planner />} />
            <Route path="planner/t/:id" element={<Planner />} />
            <Route path="planner/s/:token" element={<Planner />} />
            <Route path="planner/view/:id" element={<Planner readOnly />} />

            {/* 404 Not Found */}
            <Route path="404" element={<MainLayout />}>
              <Route index element={<NotFound />} />
            </Route>
            
            {/* Catch all routes that don't match */}
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Routes>
        </BrowserRouter>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
