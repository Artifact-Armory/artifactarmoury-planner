import React, { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useCartStore } from '../../store/cartStore';
import { Menu, X, Search, User, ShoppingCart, ChevronDown, LogOut, Settings, Heart, Package, UserPlus } from 'lucide-react';
import { authApi } from '../../api/endpoints/auth';

const Header: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isScrolled, setIsScrolled] = useState(false);
  
  const navigate = useNavigate();
  const { user, isAuthenticated, isAdmin, logout } = useAuthStore();
  const { items, totalItems, subtotal, toggleCart } = useCartStore();

  // Handle search form submission
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/browse?query=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
      setMobileMenuOpen(false);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch (error) {
      console.error('Failed to log out', error);
    }

    logout();
    setUserMenuOpen(false);
    navigate('/');
  };

  // Change header background on scroll
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 10) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        userMenuOpen &&
        e.target instanceof HTMLElement &&
        !e.target.closest('.user-menu')
      ) {
        setUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userMenuOpen]);

  // Handle Escape key to close menus
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        setUserMenuOpen(false);
      }
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 transition-all duration-300 ${
        isScrolled ? 'bg-white shadow-md' : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-4">
          {/* Logo */}
          <div className="flex-shrink-0">
            <Link to="/" className="flex items-center">
              <img
                src="/logo.svg"
                alt="Terrain Builder"
                className="h-8 w-auto"
              />
              <span className="ml-2 text-xl font-bold text-gray-900">
                Terrain Builder
              </span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex space-x-6">
            <NavLink
              to="/browse"
              className={({ isActive }) =>
                `text-base font-medium ${
                  isActive
                    ? 'text-indigo-600'
                    : 'text-gray-700 hover:text-indigo-500'
                }`
              }
            >
              Browse
            </NavLink>
            <NavLink
              to="/artists"
              className={({ isActive }) =>
                `text-base font-medium ${
                  isActive
                    ? 'text-indigo-600'
                    : 'text-gray-700 hover:text-indigo-500'
                }`
              }
            >
              Artists
            </NavLink>
            <NavLink
              to="/tables"
              className={({ isActive }) =>
                `text-base font-medium ${
                  isActive
                    ? 'text-indigo-600'
                    : 'text-gray-700 hover:text-indigo-500'
                }`
              }
            >
              Tables
            </NavLink>
            <NavLink
              to="/builder"
              className={({ isActive }) =>
                `text-base font-medium ${
                  isActive
                    ? 'text-indigo-600'
                    : 'text-gray-700 hover:text-indigo-500'
                }`
              }
            >
              Builder
            </NavLink>
            <NavLink
              to="/about"
              className={({ isActive }) =>
                `text-base font-medium ${
                  isActive
                    ? 'text-indigo-600'
                    : 'text-gray-700 hover:text-indigo-500'
                }`
              }
            >
              About
            </NavLink>
          </nav>

          {/* Desktop Search & User Controls */}
          <div className="hidden md:flex items-center space-x-4">
            {/* Search Form */}
            <form onSubmit={handleSearch} className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search terrains..."
                className="py-2 px-4 pr-10 rounded-full border border-gray-300 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 w-56"
              />
              <button
                type="submit"
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                <Search size={20} className="text-gray-400" />
              </button>
            </form>

            {/* Cart Button */}
            <button
              onClick={() => toggleCart()}
              className="relative p-2 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              aria-label="Shopping Cart"
            >
              <ShoppingCart size={22} className="text-gray-700" />
              {totalItems > 0 && (
                <span className="absolute -top-1 -right-1 bg-indigo-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {totalItems}
                </span>
              )}
            </button>

            {/* User Menu */}
            {isAuthenticated ? (
              <div className="relative user-menu">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center space-x-1 p-2 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center">
                    {user?.avatar ? (
                      <img
                        src={user.avatar}
                        alt={user.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User size={20} className="text-gray-500" />
                    )}
                  </div>
                  <ChevronDown size={16} className="text-gray-500" />
                </button>

                {/* User Dropdown Menu */}
                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50 ring-1 ring-black ring-opacity-5">
                    <div className="px-4 py-2 border-b border-gray-100">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {user?.name}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {user?.email}
                      </p>
                    </div>

                    <Link
                      to="/dashboard"
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      Dashboard
                    </Link>

                    <Link
                      to="/dashboard/profile"
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <div className="flex items-center">
                        <Settings size={16} className="mr-2" />
                        Profile Settings
                      </div>
                    </Link>

                    <Link
                      to="/dashboard/purchases"
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <div className="flex items-center">
                        <Package size={16} className="mr-2" />
                        Purchases
                      </div>
                    </Link>

                    <Link
                      to="/dashboard/wishlist"
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <div className="flex items-center">
                        <Heart size={16} className="mr-2" />
                        Wishlist
                      </div>
                    </Link>

                    {user?.role === 'artist' && (
                      <Link
                        to="/artist"
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        onClick={() => setUserMenuOpen(false)}
                      >
                        <div className="flex items-center">
                          <UserPlus size={16} className="mr-2" />
                          Artist Dashboard
                        </div>
                      </Link>
                    )}

                    {isAdmin && (
                      <Link
                        to="/admin"
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        onClick={() => setUserMenuOpen(false)}
                      >
                        <div className="flex items-center">
                          <Settings size={16} className="mr-2" />
                          Admin Panel
                        </div>
                      </Link>
                    )}

                    <div className="border-t border-gray-100 mt-1">
                      <button
                        onClick={handleLogout}
                        className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                      >
                        <div className="flex items-center">
                          <LogOut size={16} className="mr-2" />
                          Logout
                        </div>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex space-x-2">
                <Link
                  to="/login"
                  className="px-4 py-2 text-sm font-medium text-indigo-600 hover:text-indigo-500 border border-transparent rounded-md"
                >
                  Log in
                </Link>
                <Link
                  to="/register"
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 border border-transparent rounded-md shadow-sm"
                >
                  Sign up
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="flex md:hidden">
            <button
              onClick={() => toggleCart()}
              className="relative p-2 mr-2 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              aria-label="Shopping Cart"
            >
              <ShoppingCart size={22} className="text-gray-700" />
              {totalItems > 0 && (
                <span className="absolute -top-1 -right-1 bg-indigo-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {totalItems}
                </span>
              )}
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              type="button"
              className="p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              aria-controls="mobile-menu"
              aria-expanded="false"
            >
              <span className="sr-only">Open main menu</span>
              {mobileMenuOpen ? (
                <X size={24} aria-hidden="true" />
              ) : (
                <Menu size={24} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden" id="mobile-menu">
          <div className="px-4 pt-2 pb-3 space-y-1 border-t border-gray-200 bg-white shadow-lg">
            {/* Mobile Search */}
            <form onSubmit={handleSearch} className="mb-4 mt-2">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search terrains..."
                  className="w-full py-2 px-4 pr-10 rounded-md border border-gray-300 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                />
                <button
                  type="submit"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  <Search size={20} className="text-gray-400" />
                </button>
              </div>
            </form>

            {/* Mobile Navigation Links */}
            <NavLink
              to="/browse"
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `block py-2 text-base font-medium ${
                  isActive
                    ? 'text-indigo-600'
                    : 'text-gray-700 hover:text-indigo-500'
                }`
              }
            >
              Browse
            </NavLink>
            <NavLink
              to="/artists"
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `block py-2 text-base font-medium ${
                  isActive
                    ? 'text-indigo-600'
                    : 'text-gray-700 hover:text-indigo-500'
                }`
              }
            >
              Artists
            </NavLink>
            <NavLink
              to="/tables"
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `block py-2 text-base font-medium ${
                  isActive
                    ? 'text-indigo-600'
                    : 'text-gray-700 hover:text-indigo-500'
                }`
              }
            >
              Tables
            </NavLink>
            <NavLink
              to="/builder"
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `block py-2 text-base font-medium ${
                  isActive
                    ? 'text-indigo-600'
                    : 'text-gray-700 hover:text-indigo-500'
                }`
              }
            >
              Builder
            </NavLink>
            <NavLink
              to="/about"
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `block py-2 text-base font-medium ${
                  isActive
                    ? 'text-indigo-600'
                    : 'text-gray-700 hover:text-indigo-500'
                }`
              }
            >
              About
            </NavLink>

            {/* Mobile Auth Links */}
            {isAuthenticated ? (
              <div className="pt-2 border-t border-gray-200">
                <div className="flex items-center py-2">
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center mr-2">
                    {user?.avatar ? (
                      <img
                        src={user.avatar}
                        alt={user.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User size={20} className="text-gray-500" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {user?.name}
                    </p>
                    <p className="text-xs text-gray-500">{user?.email}</p>
                  </div>
                </div>

                <NavLink
                  to="/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `block py-2 text-sm ${
                      isActive
                        ? 'text-indigo-600'
                        : 'text-gray-700 hover:text-indigo-500'
                    }`
                  }
                >
                  Dashboard
                </NavLink>

                <NavLink
                  to="/dashboard/purchases"
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `block py-2 text-sm ${
                      isActive
                        ? 'text-indigo-600'
                        : 'text-gray-700 hover:text-indigo-500'
                    }`
                  }
                >
                  <div className="flex items-center">
                    <Package size={16} className="mr-2" />
                    Purchases
                  </div>
                </NavLink>

                <NavLink
                  to="/dashboard/wishlist"
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `block py-2 text-sm ${
                      isActive
                        ? 'text-indigo-600'
                        : 'text-gray-700 hover:text-indigo-500'
                    }`
                  }
                >
                  <div className="flex items-center">
                    <Heart size={16} className="mr-2" />
                    Wishlist
                  </div>
                </NavLink>

                {user?.role === 'artist' && (
                  <NavLink
                    to="/artist"
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `block py-2 text-sm ${
                        isActive
                          ? 'text-indigo-600'
                          : 'text-gray-700 hover:text-indigo-500'
                      }`
                    }
                  >
                    <div className="flex items-center">
                      <UserPlus size={16} className="mr-2" />
                      Artist Dashboard
                    </div>
                  </NavLink>
                )}

                {isAdmin && (
                  <NavLink
                    to="/admin"
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `block py-2 text-sm ${
                        isActive
                          ? 'text-indigo-600'
                          : 'text-gray-700 hover:text-indigo-500'
                      }`
                    }
                  >
                    <div className="flex items-center">
                      <Settings size={16} className="mr-2" />
                      Admin Panel
                    </div>
                  </NavLink>
                )}

                <button
                  onClick={() => {
                    handleLogout();
                    setMobileMenuOpen(false);
                  }}
                  className="block w-full text-left py-2 text-sm text-red-600"
                >
                  <div className="flex items-center">
                    <LogOut size={16} className="mr-2" />
                    Logout
                  </div>
                </button>
              </div>
            ) : (
              <div className="pt-2 border-t border-gray-200 flex space-x-4">
                <Link
                  to="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex-1 py-2 text-center text-sm font-medium text-indigo-600 hover:text-indigo-500 border border-indigo-600 rounded-md"
                >
                  Log in
                </Link>
                <Link
                  to="/register"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex-1 py-2 text-center text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 border border-transparent rounded-md"
                >
                  Sign up
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
