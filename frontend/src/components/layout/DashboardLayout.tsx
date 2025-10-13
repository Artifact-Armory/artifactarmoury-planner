import React, { useState, useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { 
  Menu, 
  X, 
  ChevronDown, 
  Home, 
  Package, 
  Heart, 
  User, 
  Layout, 
  LogOut, 
  UserPlus, 
  Users, 
  ShoppingCart, 
  List, 
  Tag, 
  BarChart2, 
  Grid,
  Settings,
  DollarSign,
  Plus,
  ChevronLeft
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useCartStore } from '../../store/cartStore';

const DashboardLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  
  const { user, isAdmin, logout } = useAuthStore();
  const { toggleCart } = useCartStore();
  
  // Close sidebar when route changes (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);
  
  // Close sidebar on escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSidebarOpen(false);
      }
    };
    
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);
  
  // Handle logout
  const handleLogout = () => {
    logout();
    navigate('/');
  };
  
  // Helper function to determine if a route is active
  const isActiveRoute = (path: string): boolean => {
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };
  
  // Get active section title
  const getPageTitle = (): string => {
    const path = location.pathname;
    
    if (path.startsWith('/admin')) {
      return 'Admin Panel';
    } else if (path.startsWith('/artist')) {
      return 'Artist Dashboard';
    } else {
      return 'Dashboard';
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-20 bg-gray-800 bg-opacity-50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      <div 
        className={`fixed top-0 left-0 z-30 h-full w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <Link to="/" className="flex items-center">
            <img src="/logo.svg" alt="Terrain Builder" className="h-8 w-auto" />
            <span className="ml-2 font-bold text-gray-900 text-lg">Terrain Builder</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden text-gray-500 hover:text-gray-900 focus:outline-none"
          >
            <X size={24} />
          </button>
        </div>
        
        {/* User Info */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center">
            <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center mr-3">
              {user?.avatar ? (
                <img 
                  src={user.avatar} 
                  alt={user.name} 
                  className="w-full h-full object-cover"
                />
              ) : (
                <User size={24} className="text-gray-500" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{user?.name}</h3>
              <p className="text-xs text-gray-500">{user?.email}</p>
            </div>
          </div>
        </div>
        
        {/* Navigation Links */}
        <nav className="p-4 overflow-y-auto h-[calc(100vh-180px)]">
          {/* Common User Navigation */}
          {!location.pathname.startsWith('/admin') && !location.pathname.startsWith('/artist') && (
            <div className="space-y-1">
              <NavLink
                to="/dashboard"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  isActiveRoute('/dashboard') && !location.pathname.includes('/')
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <Home size={18} className="mr-3" />
                Dashboard
              </NavLink>
              <NavLink
                to="/dashboard/purchases"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  isActiveRoute('/dashboard/purchases')
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <Package size={18} className="mr-3" />
                Purchases
              </NavLink>
              <NavLink
                to="/dashboard/wishlist"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  isActiveRoute('/dashboard/wishlist')
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <Heart size={18} className="mr-3" />
                Wishlist
              </NavLink>
              <NavLink
                to="/dashboard/tables"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  isActiveRoute('/dashboard/tables')
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <Grid size={18} className="mr-3" />
                My Tables
              </NavLink>
              <NavLink
                to="/dashboard/profile"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  isActiveRoute('/dashboard/profile')
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <User size={18} className="mr-3" />
                Profile Settings
              </NavLink>
            </div>
          )}

          {/* Artist Navigation */}
          {location.pathname.startsWith('/artist') && (
            <div className="space-y-1">
              <NavLink
                to="/artist"
                end
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  location.pathname === '/artist'
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <Home size={18} className="mr-3" />
                Overview
              </NavLink>
              <NavLink
                to="/artist/models"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  location.pathname.startsWith('/artist/models') && location.pathname !== '/artist/models/new'
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <Layout size={18} className="mr-3" />
                My Models
              </NavLink>
              <NavLink
                to="/artist/models/new"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  location.pathname === '/artist/models/new'
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <Plus size={18} className="mr-3" />
                Upload New Model
              </NavLink>
              <NavLink
                to="/artist/sales"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  isActiveRoute('/artist/sales')
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <DollarSign size={18} className="mr-3" />
                Sales & Analytics
              </NavLink>
              <NavLink
                to="/artist/settings"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  isActiveRoute('/artist/settings')
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <Settings size={18} className="mr-3" />
                Artist Settings
              </NavLink>
            </div>
          )}

          {/* Admin Navigation */}
          {location.pathname.startsWith('/admin') && (
            <div className="space-y-1">
              <NavLink
                to="/admin"
                end
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  location.pathname === '/admin'
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <Home size={18} className="mr-3" />
                Dashboard
              </NavLink>
              <NavLink
                to="/admin/users"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  isActiveRoute('/admin/users')
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <Users size={18} className="mr-3" />
                Users
              </NavLink>
              <NavLink
                to="/admin/models"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  isActiveRoute('/admin/models')
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <Layout size={18} className="mr-3" />
                Models
              </NavLink>
              <NavLink
                to="/admin/orders"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  isActiveRoute('/admin/orders')
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <ShoppingCart size={18} className="mr-3" />
                Orders
              </NavLink>
              <NavLink
                to="/admin/categories"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  isActiveRoute('/admin/categories')
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <List size={18} className="mr-3" />
                Categories
              </NavLink>
              <NavLink
                to="/admin/tags"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  isActiveRoute('/admin/tags')
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <Tag size={18} className="mr-3" />
                Tags
              </NavLink>
              <NavLink
                to="/admin/artist-applications"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  isActiveRoute('/admin/artist-applications')
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <UserPlus size={18} className="mr-3" />
                Artist Applications
              </NavLink>
              <NavLink
                to="/admin/reports"
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  isActiveRoute('/admin/reports')
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <BarChart2 size={18} className="mr-3" />
                Reports & Analytics
              </NavLink>
            </div>
          )}

          {/* User Actions */}
          <div className="mt-8 pt-6 border-t border-gray-200 space-y-1">
            {location.pathname.startsWith('/admin') || location.pathname.startsWith('/artist') ? (
              <NavLink
                to="/dashboard"
                className="flex items-center px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:text-indigo-700 hover:bg-indigo-50"
              >
                <ChevronLeft size={18} className="mr-3" />
                Back to User Dashboard
              </NavLink>
            ) : (
              <>
                {user?.role === 'artist' && (
                  <NavLink
                    to="/artist"
                    className="flex items-center px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:text-indigo-700 hover:bg-indigo-50"
                  >
                    <UserPlus size={18} className="mr-3" />
                    Artist Dashboard
                  </NavLink>
                )}
                {!user?.role?.includes('artist') && (
                  <NavLink
                    to="/apply-artist"
                    className="flex items-center px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:text-indigo-700 hover:bg-indigo-50"
                  >
                    <UserPlus size={18} className="mr-3" />
                    Become an Artist
                  </NavLink>
                )}
              </>
            )}

            {isAdmin && !location.pathname.startsWith('/admin') && (
              <NavLink
                to="/admin"
                className="flex items-center px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:text-indigo-700 hover:bg-indigo-50"
              >
                <Settings size={18} className="mr-3" />
                Admin Panel
              </NavLink>
            )}

            <button
              onClick={handleLogout}
              className="flex w-full items-center px-3 py-2 text-sm font-medium text-red-600 rounded-md hover:text-red-700 hover:bg-red-50"
            >
              <LogOut size={18} className="mr-3" />
              Log Out
            </button>
          </div>
        </nav>
      </div>

      {/* Main Content */}
      <div className="md:pl-64 flex flex-col min-h-screen">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-white shadow-sm">
          <div className="px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div className="flex items-center">
              {/* Mobile menu button */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="md:hidden mr-3 text-gray-500 hover:text-gray-900 focus:outline-none"
              >
                <Menu size={24} />
              </button>
              <h1 className="text-xl font-bold text-gray-900">
                {getPageTitle()}
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => toggleCart()}
                className="relative p-2 rounded-full text-gray-500 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                aria-label="Shopping Cart"
              >
                <ShoppingCart size={22} />
              </button>
              <Link
                to="/"
                className="text-gray-500 hover:text-gray-900 p-2 rounded-full hover:bg-gray-100"
                aria-label="Back to Home"
              >
                <Home size={22} />
              </Link>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 bg-gray-50">
          <Outlet />
        </main>

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200 p-4 text-center text-sm text-gray-500">
          &copy; {new Date().getFullYear()} Terrain Builder. All rights reserved.
        </footer>
      </div>
    </div>
  );
};

export default DashboardLayout;
