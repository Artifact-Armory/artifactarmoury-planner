import React from 'react'
import { useParams } from 'react-router-dom'

const Tag: React.FC = () => {
  const { id } = useParams()
  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      <h1 className="text-xl font-semibold">Tag</h1>
      <p className="text-gray-600 mt-2">Tag: {id}</p>
    </div>
  )
}

export default Tag

