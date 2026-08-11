import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Button from '../components/ui/Button';
import { useLibraryStore } from '../store/libraryStore';
import { formatPrice } from '../utils/format';

export const TableLibrary: React.FC = () => {
  const { tableId } = useParams<{ tableId: string }>();
  const { tableAssets, fetchTableAssets, removeAssetFromTable, loading, error } = useLibraryStore();
  const assets = (tableId && tableAssets[tableId]) || [];

  useEffect(() => {
    if (tableId) {
      fetchTableAssets(tableId);
    }
  }, [fetchTableAssets, tableId]);

  if (!tableId) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Select a table to continue</h1>
        <p className="mt-2 text-sm text-muted-foreground">Provide a table identifier in the URL to manage its library.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-foreground">Table Library</h1>
        <p className="text-sm text-muted-foreground">Assets currently linked to this table layout.</p>
      </header>

      {loading && <p className="text-sm text-muted-foreground">Loading table assets…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      <section className="grid gap-4 sm:grid-cols-2">
        {!loading && assets.length === 0 && (
          <p className="text-sm text-muted-foreground">No assets linked to this table yet.</p>
        )}
        {assets.map((asset) => (
          <article
            key={asset.asset_id}
            className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-xs"
          >
            <header className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">{asset.name}</h2>
              {asset.category && <span className="text-xs uppercase text-muted-foreground">{asset.category}</span>}
            </header>
            <p className="mt-2 flex-1 text-sm text-muted-foreground line-clamp-3">{asset.description}</p>
            <div className="mt-4 text-sm text-muted-foreground">
              <span>Quantity: {asset.quantity}</span>
            </div>
            <div className="mt-2 text-base font-semibold text-foreground">
              {formatPrice(asset.base_price ?? 0)}
            </div>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => removeAssetFromTable(tableId, asset.asset_id)}
            >
              Remove
            </Button>
          </article>
        ))}
      </section>
    </div>
  );
};

export default TableLibrary;
