import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLibraryStore } from '../store/libraryStore';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { useSession } from '../hooks/useSession';
import { formatPrice } from '../utils/format';

export const GlobalLibrary: React.FC = () => {
  const { tableId } = useParams<{ tableId: string }>();
  const { sessionId } = useSession();
  const [search, setSearch] = useState('');
  const { assets, loading, error, fetchAssets, addAssetToTable } = useLibraryStore();

  useEffect(() => {
    fetchAssets({ page: 1, limit: 50 });
  }, [fetchAssets]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    fetchAssets({ search: search.trim(), page: 1, limit: 50 });
  };

  const handleAdd = async (assetId: string) => {
    if (!tableId) {
      return;
    }
    await addAssetToTable(tableId, assetId);
  };

  if (!tableId) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Select a table to continue</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The asset library needs a target table identifier in the route.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-foreground">Asset Library</h1>
        <p className="text-sm text-muted-foreground">
          Browse curated assets and add them directly to your table layout.
        </p>
        <p className="text-xs text-muted-foreground">Session: {sessionId ?? 'initialising...'}</p>
      </header>

      <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          label="Search"
          placeholder="Search terrain assets"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="sm:flex-1"
        />
        <div className="flex gap-2">
          <Button type="submit">Search</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSearch('');
              fetchAssets({ page: 1, limit: 50 });
            }}
          >
            Reset
          </Button>
        </div>
      </form>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading && <p className="text-sm text-muted-foreground">Loading assets…</p>}
        {!loading && assets.length === 0 && (
          <p className="text-sm text-muted-foreground">No assets found for this query.</p>
        )}
        {assets.map((asset) => (
          <article
            key={asset.id}
            className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-xs"
          >
            <header className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">{asset.name}</h2>
              {asset.category && <span className="text-xs uppercase text-muted-foreground">{asset.category}</span>}
            </header>
            <p className="mt-2 flex-1 text-sm text-muted-foreground line-clamp-3">{asset.description}</p>
            <div className="mt-4 text-sm text-muted-foreground">
              <span>Uses: {asset.use_count ?? 0}</span>
            </div>
            <div className="mt-2 text-base font-semibold text-foreground">
              {formatPrice(asset.base_price ?? 0)}
            </div>
            <Button className="mt-4" onClick={() => handleAdd(asset.id)}>
              Add to table
            </Button>
          </article>
        ))}
      </section>
    </div>
  );
};

export default GlobalLibrary;
