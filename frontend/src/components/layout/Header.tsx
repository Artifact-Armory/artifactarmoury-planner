import React, { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useCartStore } from '../../store/cartStore';
import { Menu, X, Search, User, ShoppingCart, ChevronDown, LogOut, Settings, Heart, Package, UserPlus, Download } from 'lucide-react';
import { authApi } from '../../api/endpoints/auth';
import NotificationBell from '../notifications/NotificationBell';
import MessagesIndicator from '../messages/MessagesIndicator';
import Logo from '../common/Logo';
import ThemeToggle from '../common/ThemeToggle';
import { SITE_NAME } from '../../config/brand';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-base font-medium transition-colors ${
    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
  }`;

const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block py-2 text-base font-medium transition-colors ${
    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
  }`;

const Header: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isScrolled, setIsScrolled] = useState(false);

  const navigate = useNavigate();
  const { user, isAuthenticated, isAdmin, logout } = useAuthStore();
  const { totalItems, toggleCart } = useCartStore();

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
      className={`sticky top-0 z-40 bg-background/95 backdrop-blur-sm transition-all duration-300 ${
        isScrolled ? 'border-b border-border shadow-sm' : 'border-b border-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center gap-8 py-4">
          {/* Logo */}
          <div className="shrink-0">
            <Link to="/" className="flex items-center text-foreground">
              <Logo className="h-8 w-8 text-primary" />
              <span className="ml-2 text-xl font-bold tracking-tight">
                {SITE_NAME}
              </span>
            </Link>
          </div>

          {/* Desktop Navigation — keep it shallow: Browse · Tables · Artists · Planner.
              The planner is the differentiator, so it's always visible (never gated). */}
          <nav className="hidden md:flex items-center space-x-6 lg:space-x-8">
            <NavLink to="/browse" className={navLinkClass}>
              Browse
            </NavLink>
            <NavLink to="/tables" className={navLinkClass}>
              Tables
            </NavLink>
            <NavLink to="/artists" className={navLinkClass}>
              Artists
            </NavLink>
            <NavLink
              to="/planner"
              className={({ isActive }) =>
                `text-base font-semibold text-primary transition-colors ${
                  isActive ? '' : 'hover:text-primary/80'
                }`
              }
            >
              Planner
            </NavLink>
            <NavLink to="/bundles" className={navLinkClass}>
              Bundles
            </NavLink>
            <NavLink to="/about" className={navLinkClass}>
              About
            </NavLink>
          </nav>

          {/* Desktop Search & User Controls */}
          <div className="hidden md:flex items-center space-x-3">
            {/* Search Form */}
            <form onSubmit={handleSearch} className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search terrains..."
                className="py-2 px-4 pr-10 rounded-full border border-input bg-muted/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring focus:border-primary w-56"
              />
              <button
                type="submit"
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                <Search size={20} className="text-muted-foreground" />
              </button>
            </form>

            <ThemeToggle />

            {/* Cart Button */}
            <button
              onClick={() => toggleCart()}
              className="relative p-2 rounded-full hover:bg-accent focus:outline-hidden focus:ring-2 focus:ring-ring"
              aria-label="Shopping Cart"
            >
              <ShoppingCart size={22} className="text-foreground" />
              {totalItems > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {totalItems}
                </span>
              )}
            </button>

            {/* Messages */}
            {isAuthenticated && <MessagesIndicator />}

            {/* Notifications */}
            {isAuthenticated && <NotificationBell />}

            {/* User Menu */}
            {isAuthenticated ? (
              <div className="relative user-menu">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center space-x-1 p-2 rounded-full hover:bg-accent focus:outline-hidden focus:ring-2 focus:ring-ring"
                >
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-muted flex items-center justify-center">
                    {user?.avatar ? (
                      <img
                        src={user.avatar}
                        alt={user.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User size={20} className="text-muted-foreground" />
                    )}
                  </div>
                  <ChevronDown size={16} className="text-muted-foreground" />
                </button>

                {/* User Dropdown Menu */}
                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-popover text-popover-foreground rounded-md shadow-lg py-1 z-50 border border-border">
                    <div className="px-4 py-2 border-b border-border">
                      <p className="text-sm font-medium text-foreground truncate">
                        {user?.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {user?.email}
                      </p>
                    </div>

                    <Link
                      to="/dashboard"
                      className="block px-4 py-2 text-sm text-foreground hover:bg-accent"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      Dashboard
                    </Link>

                    <Link
                      to="/dashboard/profile"
                      className="block px-4 py-2 text-sm text-foreground hover:bg-accent"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <div className="flex items-center">
                        <Settings size={16} className="mr-2" />
                        Profile Settings
                      </div>
                    </Link>

                    <Link
                      to="/dashboard/models"
                      className="block px-4 py-2 text-sm text-foreground hover:bg-accent"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <div className="flex items-center">
                        <Download size={16} className="mr-2" />
                        My Models
                      </div>
                    </Link>

                    <Link
                      to="/dashboard/purchases"
                      className="block px-4 py-2 text-sm text-foreground hover:bg-accent"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <div className="flex items-center">
                        <Package size={16} className="mr-2" />
                        Order history
                      </div>
                    </Link>

                    <Link
                      to="/dashboard/wishlist"
                      className="block px-4 py-2 text-sm text-foreground hover:bg-accent"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <div className="flex items-center">
                        <Heart size={16} className="mr-2" />
                        Wishlist
                      </div>
                    </Link>

                    <Link
                      to="/dashboard/following"
                      className="block px-4 py-2 text-sm text-foreground hover:bg-accent"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <div className="flex items-center">
                        <UserPlus size={16} className="mr-2" />
                        Following
                      </div>
                    </Link>

                    {user?.role === 'artist' && (
                      <Link
                        to="/artist"
                        className="block px-4 py-2 text-sm text-foreground hover:bg-accent"
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
                        className="block px-4 py-2 text-sm text-foreground hover:bg-accent"
                        onClick={() => setUserMenuOpen(false)}
                      >
                        <div className="flex items-center">
                          <Settings size={16} className="mr-2" />
                          Admin Panel
                        </div>
                      </Link>
                    )}

                    <div className="border-t border-border mt-1">
                      <button
                        onClick={handleLogout}
                        className="block w-full text-left px-4 py-2 text-sm text-destructive hover:bg-accent"
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
              <div className="flex space-x-2 shrink-0">
                <Link
                  to="/login"
                  className="px-4 py-2 text-sm font-medium text-primary hover:text-primary/80 border border-transparent rounded-md whitespace-nowrap"
                >
                  Log in
                </Link>
                <Link
                  to="/register"
                  className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 border border-transparent rounded-md shadow-xs whitespace-nowrap"
                >
                  Sign up
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="flex md:hidden items-center">
            <ThemeToggle className="mr-1" />
            <button
              onClick={() => toggleCart()}
              className="relative p-2 mr-2 rounded-full hover:bg-accent focus:outline-hidden focus:ring-2 focus:ring-ring"
              aria-label="Shopping Cart"
            >
              <ShoppingCart size={22} className="text-foreground" />
              {totalItems > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {totalItems}
                </span>
              )}
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              type="button"
              className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus:outline-hidden focus:ring-2 focus:ring-ring"
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
          <div className="px-4 pt-2 pb-3 space-y-1 border-t border-border bg-background shadow-lg">
            {/* Mobile Search */}
            <form onSubmit={handleSearch} className="mb-4 mt-2">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search terrains..."
                  className="w-full py-2 px-4 pr-10 rounded-md border border-input bg-muted/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring focus:border-primary"
                />
                <button
                  type="submit"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  <Search size={20} className="text-muted-foreground" />
                </button>
              </div>
            </form>

            {/* Mobile Navigation Links — same shallow order as desktop */}
            <NavLink to="/browse" onClick={() => setMobileMenuOpen(false)} className={mobileNavLinkClass}>
              Browse
            </NavLink>
            <NavLink to="/tables" onClick={() => setMobileMenuOpen(false)} className={mobileNavLinkClass}>
              Tables
            </NavLink>
            <NavLink to="/artists" onClick={() => setMobileMenuOpen(false)} className={mobileNavLinkClass}>
              Artists
            </NavLink>
            <NavLink
              to="/planner"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-base font-semibold text-primary hover:text-primary/80"
            >
              Planner
            </NavLink>
            <NavLink to="/bundles" onClick={() => setMobileMenuOpen(false)} className={mobileNavLinkClass}>
              Bundles
            </NavLink>
            <NavLink to="/about" onClick={() => setMobileMenuOpen(false)} className={mobileNavLinkClass}>
              About
            </NavLink>

            {/* Mobile Auth Links */}
            {isAuthenticated ? (
              <div className="pt-2 border-t border-border">
                <div className="flex items-center py-2">
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-muted flex items-center justify-center mr-2">
                    {user?.avatar ? (
                      <img
                        src={user.avatar}
                        alt={user.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User size={20} className="text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {user?.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{user?.email}</p>
                  </div>
                </div>

                <NavLink
                  to="/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `block py-2 text-sm ${isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`
                  }
                >
                  Dashboard
                </NavLink>

                <NavLink
                  to="/dashboard/models"
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `block py-2 text-sm ${isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`
                  }
                >
                  <div className="flex items-center">
                    <Download size={16} className="mr-2" />
                    My Models
                  </div>
                </NavLink>

                <NavLink
                  to="/dashboard/purchases"
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `block py-2 text-sm ${isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`
                  }
                >
                  <div className="flex items-center">
                    <Package size={16} className="mr-2" />
                    Order history
                  </div>
                </NavLink>

                <NavLink
                  to="/dashboard/wishlist"
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `block py-2 text-sm ${isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`
                  }
                >
                  <div className="flex items-center">
                    <Heart size={16} className="mr-2" />
                    Wishlist
                  </div>
                </NavLink>

                <NavLink
                  to="/dashboard/following"
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `block py-2 text-sm ${isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`
                  }
                >
                  <div className="flex items-center">
                    <UserPlus size={16} className="mr-2" />
                    Following
                  </div>
                </NavLink>

                {user?.role === 'artist' && (
                  <NavLink
                    to="/artist"
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `block py-2 text-sm ${isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`
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
                      `block py-2 text-sm ${isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`
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
                  className="block w-full text-left py-2 text-sm text-destructive"
                >
                  <div className="flex items-center">
                    <LogOut size={16} className="mr-2" />
                    Logout
                  </div>
                </button>
              </div>
            ) : (
              <div className="pt-2 border-t border-border flex space-x-4">
                <Link
                  to="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex-1 py-2 text-center text-sm font-medium text-primary hover:text-primary/80 border border-primary rounded-md"
                >
                  Log in
                </Link>
                <Link
                  to="/register"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex-1 py-2 text-center text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 border border-transparent rounded-md"
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
