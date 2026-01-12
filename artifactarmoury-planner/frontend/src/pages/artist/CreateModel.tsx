import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { modelsApi } from '../../api/endpoints/models'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { LICENSE_OPTIONS } from '../../utils/licenses'

type FormValues = {
  name: string
  description: string
  category: string
  basePrice: number
  tags: string
  license: string
}

const categories = [
  { value: 'buildings', label: 'Buildings' },
  { value: 'nature', label: 'Nature' },
  { value: 'scatter', label: 'Scatter Terrain' },
  { value: 'props', label: 'Props & Accessories' },
  { value: 'complete_sets', label: 'Complete Sets' },
  { value: 'other', label: 'Other' },
]

const CreateModel: React.FC = () => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      description: '',
      category: 'buildings',
      license: 'standard-commercial',
    },
  })

  const [modelFile, setModelFile] = useState<File | null>(null)
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [galleryFiles, setGalleryFiles] = useState<File[]>([])
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [uploadStage, setUploadStage] = useState<'idle' | 'uploading' | 'processing' | 'gallery'>('idle')

  type CreateModelMutationVariables = {
    data: {
      name: string
      description: string
      category: string
      basePrice: number
      tags: string[]
      license: string
      modelFile: File
      thumbnailFile?: File
    }
    onUploadProgress?: (progress: number) => void
  }

  const uploadMutation = useMutation({
    mutationFn: ({ data, onUploadProgress }: CreateModelMutationVariables) =>
      modelsApi.createModel(data, { onUploadProgress }),
  })

  const onSubmit = handleSubmit(async (values) => {
    if (!modelFile) {
      toast.error('Please select an STL file to upload.')
      return
    }

    if (!thumbnailFile) {
      toast.error('Please upload at least one image (thumbnail).')
      return
    }

    const tags = values.tags
      ? values.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : []

    setUploadProgress(0)
    setUploadStage('uploading')

    try {
      const response = await uploadMutation.mutateAsync({
        data: {
          name: values.name,
          description: values.description,
          category: values.category,
          basePrice: Number(values.basePrice),
          tags,
          license: values.license,
          modelFile,
          thumbnailFile: thumbnailFile ?? undefined,
        },
        onUploadProgress: (percent) => {
          setUploadProgress(percent)
          if (percent >= 99) {
            setUploadStage('processing')
          } else {
            setUploadStage('uploading')
          }
        },
      })

      const modelId = response?.model?.id as string | undefined

      if (modelId && galleryFiles.length > 0) {
        setUploadStage('gallery')
        setUploadProgress(null)
        try {
          await modelsApi.uploadModelImages(modelId, galleryFiles)
          toast.success('Gallery images uploaded')
        } catch (galleryError: any) {
          const galleryMessage = galleryError?.response?.data?.message ?? 'Some gallery images could not be uploaded'
          toast.error(galleryMessage)
        }
      }

      setGalleryFiles([])
      toast.success(response?.message ?? 'Model uploaded successfully')
      await queryClient.invalidateQueries({ queryKey: ['artist-models'] })
      navigate('/artist/models')
    } catch (error: any) {
      const message = error?.response?.data?.message ?? 'Failed to upload model'
      toast.error(message)
    } finally {
      setUploadProgress(null)
      setUploadStage('idle')
    }
  })

  return (
    <div className="px-4 py-10">
      <div className="max-w-4xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Upload New Model</h1>
          <p className="mt-2 text-gray-600">
            Upload an STL file, add details, and we&apos;ll automatically generate the GLB preview and print estimates.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Model name</label>
            <input
              type="text"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Fortified Watchtower"
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
              <p className="text-xs text-gray-500">Choose how buyers may use this model.</p>
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
              {errors.basePrice && (
                <p className="text-xs text-red-600">{errors.basePrice.message?.toString()}</p>
              )}
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
              rows={5}
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

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">STL file</label>
              <input
                type="file"
                accept=".stl"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    setModelFile(file)
                  }
                }}
                className="block w-full text-sm text-gray-500 file:mr-3 file:rounded-md file:border file:border-gray-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:border-gray-300 hover:file:bg-gray-50"
              />
              <p className="text-xs text-gray-500">We&apos;ll convert STL to GLB automatically for the 3D viewer.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Thumbnail (optional)</label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => setThumbnailFile(event.target.files?.[0] ?? null)}
                className="block w-full text-sm text-gray-500 file:mr-3 file:rounded-md file:border file:border-gray-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:border-gray-300 hover:file:bg-gray-50"
              />
              <p className="text-xs text-gray-500">PNG or JPEG recommended, minimum 800×800 px.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Gallery images (optional)</label>
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  setGalleryFiles(files)
                }}
                className="block w-full text-sm text-gray-500 file:mr-3 file:rounded-md file:border file:border-gray-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:border-gray-300 hover:file:bg-gray-50"
              />
              <p className="text-xs text-gray-500">Add photos of the printed model, painted minis, or detail shots.</p>
              {galleryFiles.length > 0 && (
                <p className="text-xs text-gray-600">{galleryFiles.length} image{galleryFiles.length === 1 ? '' : 's'} selected</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
            <p>
              Tip: include assembly notes and recommended slicer settings to improve conversion rates and lower support requests.
            </p>
          </div>

          {(uploadStage === 'uploading' || uploadStage === 'processing') && (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  {uploadStage === 'uploading'
                    ? 'Uploading model…'
                    : 'Processing model (watermarking & fingerprinting)…'}
                </span>
                <span>{uploadProgress ?? 0}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-indigo-600 transition-all"
                  style={{ width: `${uploadProgress ?? 0}%` }}
                />
              </div>
            </div>
          )}
          {uploadStage === 'gallery' && (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs text-gray-600 shadow-sm">
              Uploading gallery images…
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={uploadMutation.isPending || uploadStage !== 'idle'}
              className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploadStage === 'gallery'
                ? 'Uploading gallery…'
                : uploadStage === 'processing'
                ? 'Processing…'
                : uploadMutation.isPending
                ? 'Uploading…'
                : 'Upload model'}
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

export default CreateModel
