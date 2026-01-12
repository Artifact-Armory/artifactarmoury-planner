import React from 'react'
import { useParams } from 'react-router-dom'

const TableDetails: React.FC = () => {
  const { id } = useParams()
  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-xl font-semibold">Table Details</h1>
      <p className="text-gray-600 mt-2">Table ID: {id}</p>
    </div>
  )
}

export default TableDetails

