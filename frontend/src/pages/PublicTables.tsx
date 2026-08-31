import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, Eye, Copy, Layers, ArrowRight } from 'lucide-react'
import { tablesApi } from '../api/endpoints/tables'
import type { PublicTableCard } from '../api/endpoints/tables'
import Spinner from '../components/ui/Spinner'
import Button from '../components/ui/Button'
import Seo from '../components/common/Seo'

const sortOptions: { value: 'recent' | 'updated' | 'popular'; label: string }[] = [
  { value: 'recent', label: 'Newest' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'popular', label: 'Most viewed' },
]

const PublicTables: React.FC = () => {
  const [sort, setSort] = useState<'recent' | 'updated' | 'popular'>('recent')
  const [page, setPage] = useState(1)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['public-tables', sort, page],
    queryFn: () => tablesApi.getPublicTables(page, 24, sort),
    placeholderData: (prev) => prev,
  })

  const tables = data?.tables ?? []
  const totalPages = Math.max(1, data?.totalPages ?? 1)

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <Seo
        title="Shop the Look — Community Tables"
        description="Browse tabletop layouts other builders have shared in the 3D planner — see a full board planned in terrain STLs and open any model straight from the table."
        path="/tables"
      />
      {/* Hero */}
      <section className="overflow-hidden rounded-3xl bg-primary px-8 py-10 text-primary-foreground shadow-lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/70">Shop the look</p>
            <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Community tables</h1>
            <p className="mt-3 text-sm text-primary-foreground/80">
              Real tabletop builds laid out in the planner. Open one to see every piece, add the
              whole board to your basket, or remix it into your own build.
            </p>
          </div>
          <Link
            to="/planner"
            className="inline-flex items-center gap-2 self-start rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-primary shadow-sm hover:bg-white/90"
          >
            <LayoutGrid size={16} /> Open the planner
          </Link>
        </div>
      </section>

      {/* Toolbar */}
      <div className="mt-8 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {data?.total ?? tables.length} public {(data?.total ?? tables.length) === 1 ? 'table' : 'tables'}
        </p>
        <div className="flex items-center gap-3">
          {isFetching && <Spinner size="sm" className="text-primary" />}
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Sort by
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as typeof sort)
                setPage(1)
              }}
              className="rounded-md border border-border px-3 py-2 text-sm shadow-xs focus:border-primary focus:outline-hidden"
            >
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-24">
          <Spinner size="lg" />
        </div>
      ) : tables.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border bg-card py-20 text-center">
          <LayoutGrid className="mx-auto text-muted-foreground" size={40} />
          <p className="mt-4 text-sm font-medium text-foreground">No public tables yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Build a layout in the planner and share it to feature it here.
          </p>
          <Link to="/planner" className="mt-6 inline-flex">
            <Button>Open the planner</Button>
          </Link>
        </div>
      ) : (
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {tables.map((t) => (
            <TableCard key={t.id} table={t} />
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="mt-10 flex items-center justify-center gap-4">
          <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}

const TableCard: React.FC<{ table: PublicTableCard }> = ({ table }) => {
  const thumbs = table.thumbnails.slice(0, 4)

  return (
    <li className="group overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition hover:-translate-y-0.5 hover:shadow-md">
      <Link to={`/planner/view/${table.id}`} className="block">
        {/* Mosaic preview built from the pieces on the table */}
        <div className="relative aspect-4/3 w-full bg-muted">
          {thumbs.length > 0 ? (
            <div
              className={`grid h-full w-full gap-0.5 ${
                thumbs.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
              } ${thumbs.length > 2 ? 'grid-rows-2' : 'grid-rows-1'}`}
            >
              {thumbs.map((src, i) => (
                <div
                  key={i}
                  className={`overflow-hidden bg-muted ${
                    thumbs.length === 3 && i === 0 ? 'row-span-2' : ''
                  }`}
                >
                  <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Layers size={36} />
            </div>
          )}
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
            <Layers size={12} /> {table.pieceCount} {table.pieceCount === 1 ? 'piece' : 'pieces'}
          </span>
        </div>
      </Link>

      <div className="p-4">
        <Link to={`/planner/view/${table.id}`} className="block">
          <h3 className="truncate text-base font-semibold text-foreground group-hover:text-primary">
            {table.name || 'Untitled table'}
          </h3>
        </Link>
        <p className="mt-0.5 text-sm text-muted-foreground">
          by{' '}
          {table.creatorIsArtist && table.creatorId ? (
            <Link to={`/artists/${table.creatorId}`} className="font-medium text-primary hover:underline">
              {table.creatorName}
            </Link>
          ) : (
            <span className="font-medium text-foreground">{table.creatorName}</span>
          )}
        </p>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Eye size={13} /> {table.viewCount}
            </span>
            {table.cloneCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Copy size={13} /> {table.cloneCount}
              </span>
            )}
          </span>
          <Link
            to={`/planner/view/${table.id}`}
            className="inline-flex items-center gap-1 font-medium text-primary group-hover:gap-1.5"
          >
            Shop the look <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </li>
  )
}

export default PublicTables
