import React from 'react';
import { Link } from 'react-router-dom';
import { Facebook, Twitter, Instagram, Linkedin, Youtube } from 'lucide-react';

const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-gray-900 text-gray-200">
      {/* Main Footer Content */}
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Company Info */}
          <div className="col-span-1 md:col-span-1">
            <Link to="/" className="flex items-center mb-4">
              <img
                src="/logo-white.svg"
                alt="Terrain Builder"
                className="h-8 w-auto"
              />
              <span className="ml-2 text-xl font-bold text-white">
                Terrain Builder
              </span>
            </Link>
            <p className="text-gray-400 text-sm">
              The premier marketplace for 3D terrain models. Find the perfect landscapes for your games, simulations, and visualizations.
            </p>
            <div className="flex space-x-4 mt-4">
              <a
                href="https://facebook.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="Facebook"
              >
                <Facebook size={20} />
              </a>
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="Twitter"
              >
                <Twitter size={20} />
              </a>
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="Instagram"
              >
                <Instagram size={20} />
              </a>
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="LinkedIn"
              >
                <Linkedin size={20} />
              </a>
              <a
                href="https://youtube.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="YouTube"
              >
                <Youtube size={20} />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div className="col-span-1">
            <h3 className="text-white text-lg font-semibold mb-4">Quick Links</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/browse" className="text-gray-400 hover:text-white transition-colors">
                  Browse Models
                </Link>
              </li>
              <li>
                <Link to="/artists" className="text-gray-400 hover:text-white transition-colors">
                  Artists
                </Link>
              </li>
              <li>
                <Link to="/tables" className="text-gray-400 hover:text-white transition-colors">
                  Tables
                </Link>
              </li>
              <li>
                <Link to="/about" className="text-gray-400 hover:text-white transition-colors">
                  About Us
                </Link>
              </li>
              <li>
                <Link to="/contact" className="text-gray-400 hover:text-white transition-colors">
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          {/* Categories */}
          <div className="col-span-1">
            <h3 className="text-white text-lg font-semibold mb-4">Categories</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/categories/mountains" className="text-gray-400 hover:text-white transition-colors">
                  Mountains
                </Link>
              </li>
              <li>
                <Link to="/categories/forests" className="text-gray-400 hover:text-white transition-colors">
                  Forests
                </Link>
              </li>
              <li>
                <Link to="/categories/deserts" className="text-gray-400 hover:text-white transition-colors">
                  Deserts
                </Link>
              </li>
              <li>
                <Link to="/categories/islands" className="text-gray-400 hover:text-white transition-colors">
                  Islands
                </Link>
              </li>
              <li>
                <Link to="/categories/cities" className="text-gray-400 hover:text-white transition-colors">
                  Cities
                </Link>
              </li>
              <li>
                <Link to="/categories/fantasy" className="text-gray-400 hover:text-white transition-colors">
                  Fantasy
                </Link>
              </li>
            </ul>
          </div>

          {/* Support */}
          <div className="col-span-1">
            <h3 className="text-white text-lg font-semibold mb-4">Support</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/help" className="text-gray-400 hover:text-white transition-colors">
                  Help Center
                </Link>
              </li>
              <li>
                <Link to="/faq" className="text-gray-400 hover:text-white transition-colors">
                  FAQ
                </Link>
              </li>
              <li>
                <Link to="/terms-of-service" className="text-gray-400 hover:text-white transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link to="/privacy-policy" className="text-gray-400 hover:text-white transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link to="/copyright" className="text-gray-400 hover:text-white transition-colors">
                  Copyright Information
                </Link>
              </li>
              <li>
                <Link to="/apply-artist" className="text-gray-400 hover:text-white transition-colors">
                  Become an Artist
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Newsletter Signup */}
        <div className="border-t border-gray-800 pt-8 mt-8">
          <h3 className="text-white text-lg font-semibold mb-4">Subscribe to Our Newsletter</h3>
          <p className="text-gray-400 mb-4">
            Stay updated on new terrain models, features, and special offers.
          </p>
          <form className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              placeholder="Your email address"
              className="px-4 py-2 bg-gray-800 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-grow"
              required
            />
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              Subscribe
            </button>
          </form>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="bg-gray-950 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center">
          <p className="text-gray-400 text-sm">
            &copy; {currentYear} Terrain Builder. All rights reserved.
          </p>
          <div className="mt-2 sm:mt-0 flex space-x-4">
            <a
              href="#"
              className="text-gray-400 hover:text-white text-sm transition-colors"
            >
              Sitemap
            </a>
            <a
              href="#"
              className="text-gray-400 hover:text-white text-sm transition-colors"
            >
              Cookies
            </a>
            <a
              href="#"
              className="text-gray-400 hover:text-white text-sm transition-colors"
            >
              Accessibility
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
