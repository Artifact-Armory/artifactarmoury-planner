import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { modelsApi } from '../../api/endpoints/models'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
  flagged: 'Flagged',
}

const ArtistModels: React.FC = () => {
  const queryClient = useQueryClient()

  const { data, isLoading, isFetching } = useQuery(['my-models'], () => modelsApi.getMyModels({ limit: 100 }))
  const models = data?.models ?? []

  const invalidateModels = async () => {
    await queryClient.invalidateQueries({ queryKey: ['my-models'] })
  }

  const publishModel = useMutation({
    mutationFn: (modelId: string) => modelsApi.publishModel(modelId),
    onSuccess: () => {
      toast.success('Model published')
      invalidateModels()
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message ?? 'Unable to publish model'
      toast.error(message)
    },
  })

  const unpublishModel = useMutation({
    mutationFn: (modelId: string) => modelsApi.unpublishModel(modelId),
    onSuccess: () => {
      toast.success('Model moved back to draft')
      invalidateModels()
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message ?? 'Unable to unpublish model'
      toast.error(message)
    },
  })

  const addModelToLibrary = useMutation({
    mutationFn: (modelId: string) => modelsApi.addToLibrary(modelId),
    onSuccess: () => {
      toast.success('Model added to asset library')
      invalidateModels()
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message ?? 'Unable to add model to library'
      toast.error(message)
    },
  })

  const isProcessing =
    publishModel.isLoading || unpublishModel.isLoading || addModelToLibrary.isLoading

  return (
    <div className="px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">My Models</h1>
          <p className="mt-2 text-sm text-gray-600">Create, publish, and manage your listings.</p>
        </div>
        <Button
          variant="primary"
          onClick={() => (window.location.href = '/artist/models/new')}
        >
          Create model
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : models.length === 0 ? (
        <div className="mt-12 rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-700">
            You haven’t uploaded any models yet.
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Upload your first STL to start building your catalogue.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {isFetching && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Spinner size="sm" />
              Refreshing…
            </div>
          )}

          <div className="grid gap-4">
            {models.map((model) => {
              const statusLabel = statusLabels[model.status ?? 'draft'] ?? model.status ?? 'Draft'
              const isPublished = model.status === 'published'
              const canPublish = model.status !== 'published'
              const canAddToLibrary = isPublished && !model.inLibrary
              const price = Number.isFinite(model.basePrice) ? (model.basePrice as number) : 0

              return (
                <div
                  key={model.id}
                  className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-1 items-start gap-4">
                    <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                      {model.thumbnailUrl ? (
                        <img
                          src={model.thumbnailUrl}
                          alt={model.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                          No preview
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div>
                        <h2 className="text-lg font-semibold text-gray-900">{model.name}</h2>
                        <p className="text-sm text-gray-500">
                          Status: <span className="font-medium text-gray-700">{statusLabel}</span>
                          {' · '}Visibility:{' '}
                          <span className="font-medium text-gray-700">
                            {model.visibility ? model.visibility.replace('_', ' ') : 'private'}
                          </span>
                        </p>
                      </div>
                      {model.description && (
                        <p className="text-sm text-gray-600 line-clamp-2">{model.description}</p>
                      )}
                      <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                        <span className="rounded-full bg-gray-100 px-2 py-1">
                          Category: {model.category}
                        </span>
                        <span className="rounded-full bg-gray-100 px-2 py-1">
                          Price: ${price.toFixed(2)}
                        </span>
                        {model.inLibrary && (
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">
                            In asset library
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:w-64">
                    {canPublish ? (
                      <Button
                        variant="primary"
                        loading={publishModel.isLoading && publishModel.variables === model.id}
                        disabled={isProcessing}
                        onClick={() => publishModel.mutate(model.id)}
                      >
                        Publish
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        loading={unpublishModel.isLoading && unpublishModel.variables === model.id}
                        disabled={isProcessing}
                        onClick={() => unpublishModel.mutate(model.id)}
                      >
                        Unpublish
                      </Button>
                    )}

                    <Button
                      variant="secondary"
                      loading={addModelToLibrary.isLoading && addModelToLibrary.variables === model.id}
                      disabled={!canAddToLibrary || isProcessing}
                      onClick={() => addModelToLibrary.mutate(model.id)}
                    >
                      {model.inLibrary ? 'Already in library' : 'Add to library'}
                    </Button>

                    <Button
                      variant="ghost"
                      disabled={isProcessing}
                      onClick={() => (window.location.href = `/artist/models/${model.id}/edit`)}
                    >
                      Edit details
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default ArtistModels
