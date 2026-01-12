import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import LoadingSpinner from '../common/LoadingSpinner';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'user' | 'artist' | 'admin';
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  children, 
  requiredRole 
}) => {
  const location = useLocation();
  const { isAuthenticated, isLoading, user, isAdmin } = useAuthStore();
  
  // Check if user has required role
  const hasRequiredRole = (): boolean => {
    if (!requiredRole) return true; // No specific role required
    if (!user) return false;
    
    switch (requiredRole) {
      case 'admin':
        return isAdmin;
      case 'artist':
        return user.role === 'artist' || user.role === 'admin';
      case 'user':
        return true; // All authenticated users have 'user' role
      default:
        return false;
    }
  };

  // Store the current path for redirection after login
  useEffect(() => {
    if (!isAuthenticated && !isLoading) {
      sessionStorage.setItem('redirectPath', location.pathname);
    }
  }, [isAuthenticated, isLoading, location.pathname]);
  
  // Show loading spinner while checking authentication
  if (isLoading) {
    return <LoadingSpinner size="lg" fullScreen />;
  }
  
  // If not authenticated, redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  
  // If user doesn't have required role
  if (!hasRequiredRole()) {
    // Redirect to appropriate page based on role
    if (requiredRole === 'artist' && user?.role === 'customer') {
      return <Navigate to="/apply-artist" replace />;
    }
    
    // For admin access denied or other cases
    return <Navigate to="/" replace />;
  }
  
  // If authenticated and has required role, render children
  return <>{children}</>;
};

export default ProtectedRoute;
