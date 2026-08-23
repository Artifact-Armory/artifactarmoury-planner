import React from 'react'
import { Link } from 'react-router-dom'
import { TRADEMARK_DISCLAIMER } from '../legal/TrademarkDisclaimer'
import Logo from '../common/Logo'
import { SITE_NAME } from '../../config/brand'

const Footer: React.FC = () => {
  const year = new Date().getFullYear()

  return (
    <footer className="bg-background border-t border-border text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div>
          <Link to="/" className="flex items-center text-foreground">
            <Logo variant="horizontal" title={SITE_NAME} className="h-9 w-auto" />
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">
            Craft immersive battlefields, share them with friends, and source the terrain you need.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
          <Link to="/about" className="hover:text-foreground">
            About
          </Link>
          <Link to="/contact" className="hover:text-foreground">
            Contact
          </Link>
          <Link to="/privacy-policy" className="hover:text-foreground">
            Privacy Policy
          </Link>
          <Link to="/terms-of-service" className="hover:text-foreground">
            Terms of Service
          </Link>
        </div>

        <p className="text-sm text-muted-foreground sm:text-right">
          &copy; {year} {SITE_NAME}. All rights reserved.
        </p>
      </div>

      <div className="border-t border-border">
        <p className="mx-auto max-w-7xl px-4 py-4 text-xs leading-relaxed text-muted-foreground sm:px-6 lg:px-8">
          {TRADEMARK_DISCLAIMER}
        </p>
      </div>
    </footer>
  )
}

export default Footer
