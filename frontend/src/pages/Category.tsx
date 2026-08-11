import React from 'react'
import { Link, useParams } from 'react-router-dom'

const Category: React.FC = () => {
  const { id } = useParams()
  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      <h1 className="text-xl font-semibold text-foreground">Category</h1>
      <p className="mt-2 text-muted-foreground">Category: {id}</p>
      <Link to="/browse" className="mt-4 inline-block text-sm font-medium text-primary hover:text-primary/80">
        Browse all models →
      </Link>
    </div>
  )
}

export default Category
