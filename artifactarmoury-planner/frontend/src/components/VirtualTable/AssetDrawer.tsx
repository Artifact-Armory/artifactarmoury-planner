import React, { useEffect, useMemo, useState } from 'react'
import { useLibraryStore } from '../../store/libraryStore'
import Button from '../ui/Button'
import Input from '../ui/Input'

type AssetDrawerProps = {
  tableId?: string
  isOpen: boolean
  onClose: () => void
  onSelectAsset: (assetId: string) => void
}

export const AssetDrawer: React.FC<AssetDrawerProps> = ({ tableId, isOpen, onClose, onSelectAsset }) => {
  const [search, setSearch] = useState('')
  const { assets, loading, fetchAssets, addAssetToTable } = useLibraryStore()

  useEffect(() => {
    if (isOpen) {
      fetchAssets({ page: 1, limit: 40 })
    }
  }, [isOpen, fetchAssets])

  const filteredAssets = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return assets
    return assets.filter((asset) => asset.name.toLowerCase().includes(term))
  }, [assets, search])

  const handleAdd = async (assetId: string) => {
    if (tableId) {
      await addAssetToTable(tableId, assetId)
    }
    onSelectAsset(assetId)
  }

  return (
    <div
      className={`fixed inset-0 z-50 transition ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
      aria-hidden={!isOpen}
    >
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <aside
        className={`absolute right-0 top-0 h-full w-full max-w-lg bg-white shadow-xl transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Asset Library</h2>
            <p className="text-xs text-gray-500">Select an asset to add to the table.</p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="space-y-4 px-6 py-4">
          <Input
            placeholder="Search assets"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <div className="h-[70vh] overflow-y-auto space-y-3 pr-2">
            {loading && <p className="text-sm text-gray-500">Loading assets…</p>}
            {!loading && filteredAssets.length === 0 && (
              <p className="text-sm text-gray-500">No assets match this search.</p>
            )}
            {filteredAssets.map((asset) => (
              <div key={asset.id} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{asset.name}</h3>
                    {asset.category && (
                      <p className="text-xs uppercase text-gray-500 mt-1">{asset.category}</p>
                    )}
                    <p className="mt-2 text-xs text-gray-600 line-clamp-3">{asset.description}</p>
                  </div>
                  <Button size="sm" onClick={() => handleAdd(asset.id)}>
                    Add
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  )
}

export default AssetDrawer
