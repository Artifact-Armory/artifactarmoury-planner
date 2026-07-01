import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useAuthStore } from './store/authStore';
import { authApi } from './api/endpoints/auth';

// Layouts
import MainLayout from './components/layout/MainLayout';
import DashboardLayout from './components/layout/DashboardLayout';

// Auth Components
import ProtectedRoute from './components/auth/ProtectedRoute';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
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
import TableDetails from './pages/TableDetails';
import PublicTables from './pages/PublicTables';
import Contact from './pages/Contact';
import About from './pages/About';
import NotFound from './pages/NotFound';
import PrivacyPolicy from './pages/legal/PrivacyPolicy';
import TermsOfService from './pages/legal/TermsOfService';
import Checkout from './pages/Checkout';
import GlobalLibrary from './pages/GlobalLibrary';
import TableLibrary from './pages/TableLibrary';
import TerrainBuilderPage from './pages/TerrainBuilderPage';

// User Dashboard Pages
import Dashboard from './pages/dashboard/Dashboard';
import PurchaseHistory from './pages/dashboard/PurchaseHistory';
import Wishlist from './pages/dashboard/Wishlist';
import UserProfile from './pages/dashboard/UserProfile';
import MyTables from './pages/dashboard/MyTables';
import EditTable from './pages/dashboard/EditTable';

// Artist Pages
import ArtistDashboard from './pages/artist/ArtistDashboard';
import ArtistModels from './pages/artist/ArtistModels';
import CreateModel from './pages/artist/CreateModel';
import EditModel from './pages/artist/EditModel';
import ArtistSales from './pages/artist/ArtistSales';
import ArtistSettings from './pages/artist/ArtistSettings';
import ArtistApplication from './pages/artist/ArtistApplication';

// Admin Pages
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminUsers from './pages/admin/AdminUsers';
import AdminModels from './pages/admin/AdminModels';
import AdminOrders from './pages/admin/AdminOrders';
import AdminCategories from './pages/admin/AdminCategories';
import AdminTags from './pages/admin/AdminTags';
import AdminArtistApplications from './pages/admin/AdminArtistApplications';
import AdminReports from './pages/admin/AdminReports';

// Error Boundary
import ErrorBoundary from './components/common/ErrorBoundary';
import { Toaster } from 'react-hot-toast';

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

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Toaster position="top-center" />
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<MainLayout />}>
              <Route index element={<Home />} />
              <Route path="browse" element={<Browse />} />
              <Route path="models/:id" element={<ModelDetails />} />
              <Route path="artists" element={<ArtistsList />} />
              <Route path="artists/:id" element={<ArtistProfile />} />
              <Route path="categories/:id" element={<Category />} />
              <Route path="tags/:id" element={<Tag />} />
              <Route path="tables" element={<PublicTables />} />
              <Route path="tables/:id" element={<TableDetails />} />
              <Route path="about" element={<About />} />
              <Route path="contact" element={<Contact />} />
              <Route path="privacy-policy" element={<PrivacyPolicy />} />
              <Route path="terms-of-service" element={<TermsOfService />} />
              <Route path="builder" element={<TerrainBuilderPage />} />
              
              {/* Auth Routes */}
              <Route path="login" element={<Login />} />
              <Route path="register" element={<Register />} />
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
              <Route path="purchases" element={<PurchaseHistory />} />
              <Route path="wishlist" element={<Wishlist />} />
              <Route path="profile" element={<UserProfile />} />
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
              <Route path="sales" element={<ArtistSales />} />
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
              <Route path="reports" element={<AdminReports />} />
            </Route>

            {/* Asset Library */}
            <Route path="/library" element={<MainLayout />}>
              <Route path="browse/:tableId" element={<GlobalLibrary />} />
              <Route path="manage/:tableId" element={<TableLibrary />} />
            </Route>

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
