import React from 'react'
import { Link, useParams } from 'react-router-dom'
import TerrainBuilder from '@ui/App'

const EditTable: React.FC = () => {
  const { id } = useParams<{ id: string }>()

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4 backdrop-blur">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-100">Tabletop Terrain Builder</h1>
            <p className="text-xs text-slate-400">
              Design your table layout, export shopping lists, and save presets for future games.
            </p>
          </div>
          {id && (
            <div className="flex flex-wrap gap-2">
              <Link
                to={`/library/manage/${id}`}
                className="inline-flex items-center rounded-md border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-indigo-400"
              >
                Manage table library
              </Link>
              <Link
                to={`/library/browse/${id}`}
                className="inline-flex items-center rounded-md border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-indigo-400"
              >
                Browse global assets
              </Link>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1">
        <TerrainBuilder tableId={id} />
      </main>
    </div>
  )
}

export default EditTable
