import React, { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'

import { modelsApi } from '../../api/endpoints/models'
import { ModelUploadRequest } from '../../api/types'
import { LICENSE_OPTIONS } from '../../utils/licenses'

type FormValues = {
  name: string
  description: string
  category: string
  basePrice: number
  license: string
  tags: string
}

const categories = [
  { value: 'buildings', label: 'Buildings' },
  { value: 'nature', label: 'Nature' },
  { value: 'scatter', label: 'Scatter Terrain' },
  { value: 'props', label: 'Props & Accessories' },
  { value: 'complete_sets', label: 'Complete Sets' },
  { value: 'other', label: 'Other' },
]

const EditModel: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [newGalleryFiles, setNewGalleryFiles] = useState<File[]>([])
  const [isGalleryUploading, setIsGalleryUploading] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      name: '',
      description: '',
      category: 'buildings',
      basePrice: 0,
      license: 'standard-commercial',
      tags: '',
    },
  })

  const modelQuery = useQuery({
    queryKey: ['model', id],
    queryFn: () => modelsApi.getModelById(id as string),
    enabled: Boolean(id),
  })

  useEffect(() => {
    if (modelQuery.data) {
      reset({
        name: modelQuery.data.name ?? '',
        description: modelQuery.data.description ?? '',
        category: modelQuery.data.category ?? 'buildings',
        basePrice: modelQuery.data.basePrice ?? 0,
        license: modelQuery.data.license ?? 'standard-commercial',
        tags: modelQuery.data.tags?.join(', ') ?? '',
      })
    }
  }, [modelQuery.data, reset])

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<ModelUploadRequest>) =>
      modelsApi.updateModel(id as string, payload),
  })

  const deleteImageMutation = useMutation({
    mutationFn: (imageId: string) => modelsApi.deleteModelImage(id as string, imageId),
    onSuccess: () => {
      toast.success('Image removed')
      queryClient.invalidateQueries({ queryKey: ['model', id] })
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message ?? 'Unable to delete image')
    },
  })

  const handleDeleteImage = (imageId: string) => {
    if (!id) return
    const confirmed = window.confirm('Remove this image?')
    if (!confirmed) return
    deleteImageMutation.mutate(imageId)
  }

  const onSubmit = handleSubmit(async (values) => {
    if (!id) return

    const tagsArray = values.tags
      ? values.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : []

    try {
      const updatePayload: Partial<ModelUploadRequest> = {
        name: values.name,
        description: values.description,
        category: values.category,
        basePrice: Number(values.basePrice),
        license: values.license,
        tags: tagsArray,
      }

      await updateMutation.mutateAsync(updatePayload)

      toast.success('Model details updated')

      if (newGalleryFiles.length > 0) {
        setIsGalleryUploading(true)
        try {
          await modelsApi.uploadModelImages(id, newGalleryFiles)
          toast.success('Gallery images uploaded')
          setNewGalleryFiles([])
        } catch (galleryError: any) {
          const galleryMessage = galleryError?.response?.data?.message ?? 'Some gallery images could not be uploaded'
          toast.error(galleryMessage)
        } finally {
          setIsGalleryUploading(false)
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['artist-models'] }),
        queryClient.invalidateQueries({ queryKey: ['model', id] }),
      ])
    } catch (error: any) {
      const message = error?.response?.data?.message ?? 'Failed to update model'
      toast.error(message)
    }
  })

  const existingModel = modelQuery.data
  const existingImages = existingModel?.images ?? []

  const isSaving = isSubmitting || updateMutation.isPending || isGalleryUploading
  const primaryButtonLabel = isGalleryUploading
    ? 'Uploading gallery…'
    : isSubmitting || updateMutation.isPending
    ? 'Saving…'
    : 'Save changes'

  if (!id) {
    return (
      <div className="px-4 py-10 text-sm text-gray-500">
        Invalid model id.{' '}
        <button className="underline" onClick={() => navigate('/artist/models')}>
          Go back
        </button>
      </div>
    )
  }

  if (modelQuery.isLoading) {
    return <div className="px-4 py-10 text-sm text-gray-500">Loading model…</div>
  }

  if (modelQuery.isError || !existingModel) {
    return (
      <div className="px-4 py-10 text-sm text-red-600">
        Failed to load model.{' '}
        <button className="underline" onClick={() => navigate('/artist/models')}>
          Go back
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-10">
      <div className="max-w-4xl space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Edit {existingModel.name}</h1>
            <p className="mt-2 text-sm text-gray-600">Update details, description, and gallery images.</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/artist/models')}
            className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Back to My Models
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Model name</label>
              <input
                type="text"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Model name"
                {...register('name', { required: 'Name is required' })}
              />
              {errors.name && <p className="text-xs text-red-600">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Category</label>
              <select
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                {...register('category', { required: true })}
              >
                {categories.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">License</label>
              <select
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                {...register('license', { required: 'License is required' })}
              >
                {LICENSE_OPTIONS.map((licenseOption) => (
                  <option key={licenseOption.value} value={licenseOption.value}>
                    {licenseOption.label}
                  </option>
                ))}
              </select>
              {errors.license && <p className="text-xs text-red-600">{errors.license.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Base price</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-sm text-gray-500">£</span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 pl-7 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="12.50"
                  {...register('basePrice', {
                    required: 'Base price is required',
                    valueAsNumber: true,
                    min: { value: 0, message: 'Price cannot be negative' },
                  })}
                />
              </div>
              {errors.basePrice && <p className="text-xs text-red-600">{errors.basePrice.message?.toString()}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Tags</label>
              <input
                type="text"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="watchtower, medieval, modular"
                {...register('tags')}
              />
              <p className="text-xs text-gray-500">Separate tags with commas.</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Description</label>
            <textarea
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              rows={6}
              placeholder="Describe print dimensions, modular options, assembly guidance, and recommended print settings."
              {...register('description', {
                required: 'Description is required',
                minLength: { value: 20, message: 'Please provide at least 20 characters' },
              })}
            />
            {errors.description && (
              <p className="text-xs text-red-600">{errors.description.message}</p>
            )}
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Gallery</h2>
            {existingImages.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-3">
                {existingImages.map((image) => (
                  <div key={image.id} className="overflow-hidden rounded-lg border border-gray-200">
                    <img
                      src={image.imageUrl ?? image.imagePath ?? ''}
                      alt={existingModel.name}
                      className="h-32 w-full object-cover"
                    />
                    <div className="flex items-center justify-between border-t border-gray-200 px-3 py-2 text-xs text-gray-600">
                      <span>Image #{(image.displayOrder ?? 0) + 1}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteImage(image.id)}
                        className="text-red-600 hover:text-red-700"
                        disabled={deleteImageMutation.isPending}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500">No gallery images yet. Add some below.</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Add new gallery images</label>
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                setNewGalleryFiles(files)
              }}
              className="block w-full text-sm text-gray-500 file:mr-3 file:rounded-md file:border file:border-gray-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:border-gray-300 hover:file:bg-gray-50"
            />
            {newGalleryFiles.length > 0 && (
              <p className="text-xs text-gray-600">{newGalleryFiles.length} image{newGalleryFiles.length === 1 ? '' : 's'} selected</p>
            )}
          </div>

          {isGalleryUploading && (
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs text-gray-600 shadow-sm">
              Uploading gallery images…
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {primaryButtonLabel}
            </button>
            <button
              type="button"
              onClick={() => navigate('/artist/models')}
              className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default EditModel
