import React, { useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { modelsApi } from '../../api/endpoints/models'
import { TerrainModel } from '../../api/types'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CheckCircle2, Eye, PenSquare, RefreshCw, UploadCloud, Trash2 } from 'lucide-react'
import { formatLicense } from '../../utils/licenses'

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)

const formatDate = (value?: string) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '—'

const STATUSES = [
  { label: 'All', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Published', value: 'published' },
  { label: 'Archived', value: 'archived' },
]

const PAGE_SIZE = 10

const ArtistModels: React.FC = () => {
  type MyModelsResponse = Awaited<ReturnType<typeof modelsApi.getMyModels>>
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'published' | 'archived'>('all')
  const [page, setPage] = useState(1)

  const { data, isLoading, isFetching } = useQuery<MyModelsResponse>({
    queryKey: ['artist-models', statusFilter, page],
    queryFn: () =>
      modelsApi.getMyModels({
        status: statusFilter === 'all' ? undefined : statusFilter,
        page,
        limit: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  })

  const publishMutation = useMutation({
    mutationFn: (id: string) => modelsApi.publishModel(id),
    onSuccess: () => {
      toast.success('Model published')
      queryClient.invalidateQueries({ queryKey: ['artist-models'] })
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message ?? 'Unable to publish model')
    },
  })

  const unpublishMutation = useMutation({
    mutationFn: (id: string) => modelsApi.unpublishModel(id),
    onSuccess: () => {
      toast.success('Model reverted to draft')
      queryClient.invalidateQueries({ queryKey: ['artist-models'] })
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message ?? 'Unable to unpublish model')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => modelsApi.deleteModel(id),
    onSuccess: () => {
      toast.success('Model deleted')
      queryClient.invalidateQueries({ queryKey: ['artist-models'] })
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message ?? 'Unable to delete model')
    },
  })

  const addToLibraryMutation = useMutation({
    mutationFn: (id: string) => modelsApi.addToLibrary(id),
    onSuccess: () => {
      toast.success('Added to asset library')
      queryClient.invalidateQueries({ queryKey: ['artist-models'] })
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message ?? 'Unable to add model to library'
      toast.error(message)
    },
  })

  const models: TerrainModel[] = data?.models ?? []
  const pagination = data?.pagination

  const canPrevious = (pagination?.page ?? 1) > 1
  const canNext = pagination ? pagination.page < pagination.totalPages : false

  const handlePublishToggle = (model: TerrainModel) => {
    if (model.status === 'published') {
      unpublishMutation.mutate(model.id)
    } else {
      publishMutation.mutate(model.id)
    }
  }

  const handleDelete = (model: TerrainModel) => {
    const confirmed = window.confirm(`Delete "${model.name}"? This action cannot be undone.`)
    if (!confirmed) return
    deleteMutation.mutate(model.id)
  }

  const handleAddToLibrary = (model: TerrainModel) => {
    addToLibraryMutation.mutate(model.id)
  }

  const statusBadge = useMemo(
    () =>
      ({
        draft: 'bg-gray-100 text-gray-700',
        published: 'bg-emerald-50 text-emerald-700',
        archived: 'bg-amber-50 text-amber-700',
      } as Record<string, string>),
    [],
  )

  return (
    <div className="px-4 py-10 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">My Models</h1>
          <p className="text-gray-600">Manage your catalogue, publish new releases, and monitor performance.</p>
        </div>
        <Link
          to="/artist/models/new"
          className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          <UploadCloud size={18} className="mr-2" />
          Upload New Model
        </Link>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="text-sm font-medium text-gray-700">
            Filter by status
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as typeof statusFilter)
              setPage(1)
            }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </div>
        <div className="text-sm text-gray-500">
          {pagination
            ? `Showing ${(pagination.page - 1) * pagination.limit + 1}-${Math.min(
                pagination.page * pagination.limit,
                pagination.totalItems,
              )} of ${pagination.totalItems}`
            : ' '} {isFetching && <RefreshCw className="ml-2 inline h-4 w-4 animate-spin text-indigo-500" />}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Model</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">License</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Price</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Views</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Sales</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Updated</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                Array.from({ length: PAGE_SIZE }).map((_, index) => (
                  <tr key={index} className="animate-pulse">
                    <td className="px-4 py-4" colSpan={8}>
                      <div className="h-5 rounded bg-gray-100" />
                    </td>
                  </tr>
                ))
              ) : models.length > 0 ? (
                models.map((model) => (
                  <tr key={model.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        {model.thumbnailUrl ? (
                          <img
                            src={model.thumbnailUrl}
                            alt={model.name}
                            className="h-12 w-12 rounded-md object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-gray-300 text-xs text-gray-400">
                            No thumbnail
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-gray-900">{model.name}</p>
                          <p className="text-sm text-gray-500 capitalize">{model.category}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                          statusBadge[model.status ?? 'draft'] || 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {(model.status ?? 'draft').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-700">{formatLicense(model.license)}</td>
                    <td className="px-4 py-4 text-sm text-gray-700">{formatCurrency(model.basePrice ?? 0)}</td>
                    <td className="px-4 py-4 text-sm text-gray-700">{model.viewCount ?? 0}</td>
                    <td className="px-4 py-4 text-sm text-gray-700">{model.saleCount ?? 0}</td>
                    <td className="px-4 py-4 text-sm text-gray-700">{formatDate(model.updatedAt)}</td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/artist/models/${model.id}/edit`}
                          className="inline-flex items-center rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-300 hover:text-indigo-600"
                        >
                          <PenSquare size={14} className="mr-1" />
                          Edit
                        </Link>
                        <button
                          onClick={() => handlePublishToggle(model)}
                          className="inline-flex items-center rounded-md border border-indigo-200 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50"
                          disabled={publishMutation.isPending || unpublishMutation.isPending}
                        >
                          {model.status === 'published' ? (
                            <>
                              <Eye size={14} className="mr-1" /> Unpublish
                            </>
                          ) : (
                            <>
                              <CheckCircle2 size={14} className="mr-1" /> Publish
                            </>
                          )}
                        </button>
                        {!model.inLibrary && (
                          <button
                            onClick={() => handleAddToLibrary(model)}
                            className="inline-flex items-center rounded-md border border-emerald-200 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={addToLibraryMutation.isPending}
                          >
                            Add to library
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(model)}
                          className="inline-flex items-center rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 size={14} className="mr-1" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-gray-500" colSpan={8}>
                    You haven&apos;t uploaded any models yet. Start by uploading your first STL file.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {pagination && (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
            <span>
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => canPrevious && setPage((prev) => Math.max(prev - 1, 1))}
                disabled={!canPrevious}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => canNext && setPage((prev) => prev + 1)}
                disabled={!canNext}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ArtistModels
