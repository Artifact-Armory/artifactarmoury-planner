import React from 'react'
import { Link } from 'react-router-dom'
import Seo from '../components/common/Seo'

const NotFound: React.FC = () => {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4">
      <Seo title="Page Not Found" noindex />
      <h1 className="text-3xl font-semibold mb-2">404 - Page Not Found</h1>
      <p className="text-muted-foreground mb-6">The page you are looking for doesn’t exist.</p>
      <Link to="/" className="text-primary hover:underline">Go home</Link>
    </div>
  )
}

export default NotFound
