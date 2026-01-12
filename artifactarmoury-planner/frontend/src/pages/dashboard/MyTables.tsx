import React from 'react'
import { Link } from 'react-router-dom'

const MyTables: React.FC = () => {
  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">My Table Layouts</h1>
          <p className="text-gray-600 mt-1">
            Create, save, and export terrain layouts for your tabletop sessions.
          </p>
        </div>
        <Link
          to="/dashboard/tables/new"
          className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          Open Builder
        </Link>
      </header>

      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
        <h2 className="text-lg font-medium text-gray-900">No saved layouts yet</h2>
        <p className="mt-2 text-sm text-gray-600">
          Use the builder to design your first table and save it for future games.
        </p>
        <Link
          to="/dashboard/tables/new"
          className="mt-6 inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
        >
          Start building
        </Link>
      </div>
    </div>
  )
}

export default MyTables
