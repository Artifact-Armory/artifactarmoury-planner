// src/ui/StatusBar.tsx
import React from 'react'
import { useAppStore } from '@state/store'

export function StatusBar() {
  const instances = useAppStore((s) => s.instances)
  const selectedInstanceId = useAppStore((s) => s.selectedInstanceId)
  const selectedAssetId = useAppStore((s) => s.selectedAssetId)
  const basket = useAppStore((s) => s.basket)
  const cameraMode = useAppStore((s) => s.cameraMode)
  const assets = useAppStore((s) => s.assets)

  const totalItems = basket.reduce((sum, item) => sum + item.quantity, 0)
  const totalCost = basket.reduce((sum, item) => sum + item.quantity * 35, 0)

  const selectedInstance = instances.find((instance) => instance.id === selectedInstanceId)
  const selectedAsset = selectedInstance
    ? assets.find((asset) => asset.id === selectedInstance.assetId)
    : selectedAssetId
    ? assets.find((asset) => asset.id === selectedAssetId)
    : null

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'rgba(18, 24, 33, 0.95)',
        borderTop: '1px solid #243246',
        padding: '8px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', gap: 24 }}>
        <div>
          <span className="tb-small" style={{ color: '#9fb2c8' }}>
            Placed:{' '}
          </span>
          <strong>{instances.length}</strong>
        </div>
        <div>
          <span className="tb-small" style={{ color: '#9fb2c8' }}>
            Basket:{' '}
          </span>
          <strong>{totalItems} items</strong>
        </div>
        <div>
          <span className="tb-small" style={{ color: '#9fb2c8' }}>
            Est. Total:{' '}
          </span>
          <strong>\u00a3{totalCost.toFixed(0)}</strong>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        {selectedAsset && (
          <div>
            <span className="tb-small" style={{ color: '#4da3ff' }}>
              {selectedInstanceId ? 'Selected: ' : 'Placing: '}
            </span>
            <strong>{selectedAsset.name}</strong>
          </div>
        )}
        <div>
          <span className="tb-small" style={{ color: '#9fb2c8' }}>
            View:{' '}
          </span>
          <strong style={{ textTransform: 'capitalize' }}>{cameraMode}</strong>
        </div>
      </div>
    </div>
  )
}
