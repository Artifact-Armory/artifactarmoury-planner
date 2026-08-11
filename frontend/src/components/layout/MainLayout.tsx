import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import Footer from './footer';
import VerifyEmailBanner from './VerifyEmailBanner';
import CartDrawer from '../cart/CartDrawer';

const MainLayout: React.FC = () => {
  const location = useLocation();

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Header />
      <VerifyEmailBanner />

      <main className="grow">
        <Outlet />
      </main>
      
      <Footer />

      <CartDrawer />
      {/* Toaster lives once at the app root (app.tsx) — a second one here caused
          toasts to double up and not auto-dismiss. */}
    </div>
  );
};

export default MainLayout;
