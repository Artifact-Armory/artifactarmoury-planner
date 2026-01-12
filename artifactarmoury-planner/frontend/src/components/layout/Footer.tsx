import React from 'react'
import { Link } from 'react-router-dom'

const Footer: React.FC = () => {
  const year = new Date().getFullYear()

  return (
    <footer className="bg-gray-900 text-gray-200">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div>
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo-white.svg" alt="Terrain Builder" className="h-8 w-auto" />
            <span className="text-lg font-semibold">Terrain Builder</span>
          </Link>
          <p className="mt-2 text-sm text-gray-400">
            Craft immersive battlefields, share them with friends, and source the terrain you need.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-gray-400">
          <Link to="/about" className="hover:text-white">
            About
          </Link>
          <Link to="/contact" className="hover:text-white">
            Contact
          </Link>
          <Link to="/privacy-policy" className="hover:text-white">
            Privacy Policy
          </Link>
          <Link to="/terms-of-service" className="hover:text-white">
            Terms of Service
          </Link>
        </div>

        <p className="text-sm text-gray-500 sm:text-right">
          &copy; {year} Artifact Armoury. All rights reserved.
        </p>
      </div>
    </footer>
  )
}

export default Footer
