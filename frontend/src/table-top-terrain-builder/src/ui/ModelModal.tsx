import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Loader2,
  X,
  CheckCircle2,
  BadgeCheck,
  Layers,
  Ruler,
  FileType,
  ShieldCheck,
  PackagePlus,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'

import { useBuilderUIStore } from '@state/uiStore'
import { useAppStore } from '@state/store'
import { modelsApi } from '@/api/endpoints/models'
import { MODEL_SHOWCASE_ENABLED } from '@/config/features'

const fileFormatsToBadges = (formats: string[]) =>
  formats.map((format) => (
    <span key={format} className="rounded-full bg-slate-700/70 px-3 py-1 text-xs font-semibold text-slate-200">
      {format.toUpperCase()}
    </span>
  ))

export function ModelModal() {
  const { modelModal, closeModelModal } = useBuilderUIStore((state) => ({
    modelModal: state.modelModal,
    closeModelModal: state.closeModelModal,
  }))
  const addToBasket = useAppStore((state) => state.actions.addToBasket)
  const setSelectedAsset = useAppStore((state) => state.setSelectedAsset)

  const { data: model, isFetching } = useQuery({
    queryKey: ['terrain-model', modelModal.modelId],
    enabled: MODEL_SHOWCASE_ENABLED && modelModal.open && !!modelModal.modelId,
    queryFn: async () => modelsApi.getModelById(modelModal.modelId!),
  })

  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!modelModal.open) return

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeModelModal()
      }
    }

    previouslyFocused.current = document.activeElement as HTMLElement
    window.addEventListener('keydown', handleKey)
    setTimeout(() => closeButtonRef.current?.focus(), 0)

    return () => {
      window.removeEventListener('keydown', handleKey)
      previouslyFocused.current?.focus?.()
    }
  }, [modelModal.open, closeModelModal])

  useEffect(() => {
    if (!MODEL_SHOWCASE_ENABLED && modelModal.open) {
      closeModelModal()
    }
  }, [modelModal.open, closeModelModal])

  if (!MODEL_SHOWCASE_ENABLED || !modelModal.open) {
    return null
  }

  if (typeof document === 'undefined') {
    return null
  }

  const images = model?.previewImages?.length
    ? model.previewImages
    : model?.images?.map((image) => image.imageUrl ?? image.imagePath ?? '').filter(Boolean) ?? []

  const license = model?.tags?.find((tag) => tag.toLowerCase().includes('license')) ?? 'Standard License'
  const fileFormats = ['STL']
  if (model?.glbUrl) fileFormats.push('GLB')

  const handlePlace = () => {
    if (!model) return
    setSelectedAsset(model.id)
    addToBasket(model.id, 1)
    toast.success(`${model.name} added to basket`, { duration: 2000 })
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeModelModal} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-modal-title"
        className="relative z-10 grid max-h-[90vh] w-full max-w-5xl grid-cols-1 overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-2xl transition-all duration-200 ease-out md:grid-cols-[0.4fr_0.6fr]"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={closeModelModal}
          aria-label="Close model details"
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-800/80 text-slate-200 transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="relative flex flex-col bg-slate-900/90 p-6">
          <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-white/10 bg-slate-800/80">
            {isFetching ? (
              <div className="flex h-full w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" aria-hidden="true" />
              </div>
            ) : images.length > 0 ? (
              <img src={images[0]} alt={model?.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-3xl font-semibold text-white/70">
                {model?.name?.slice(0, 2) ?? 'AA'}
              </div>
            )}
            <span className="absolute left-4 top-4 rounded-full bg-slate-900/70 px-3 py-1 text-xs font-semibold text-sky-200">
              {license}
            </span>
          </div>
          {images.length > 1 && (
            <div className="mt-4 flex gap-2 overflow-x-auto">
              {images.slice(1).map((image, index) => (
                <img
                  key={index}
                  src={image}
                  alt={`Preview ${index + 2}`}
                  className="h-20 w-20 flex-none rounded-md border border-transparent object-cover transition-colors hover:border-sky-400"
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex h-full flex-col bg-slate-900/95">
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
            <div>
              <h1 id="model-modal-title" className="text-2xl font-bold text-slate-50">
                {model?.name ?? 'Model'}
              </h1>
              <div className="mt-2 flex items-center gap-3 text-sm text-slate-300">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500/20 text-sky-200 font-semibold">
                  {(model?.artistName ?? 'You').slice(0, 2)}
                </div>
                <button type="button" className="font-semibold text-sky-300 hover:underline">
                  {model?.artistName ?? 'You'}
                </button>
                <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                <button
                  type="button"
                  className="ml-auto rounded-md border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  Follow
                </button>
              </div>
              <p className="mt-4 text-3xl font-bold text-sky-400">
                £{model?.basePrice?.toFixed(2) ?? '0.00'}
              </p>
            </div>

            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Description</h2>
              <p className="mt-2 max-h-40 overflow-y-auto text-sm leading-relaxed text-slate-200">
                {model?.description ?? 'No description provided.'}
              </p>
            </div>

            <div className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Specifications</h2>
              <div className="grid grid-cols-2 gap-3 text-sm text-slate-200">
                <SpecRow icon={<Ruler className="h-4 w-4" aria-hidden="true" />} label="Dimensions">
                  {formatDimension(model?.width)} × {formatDimension(model?.height)} × {formatDimension(model?.depth)} m
                </SpecRow>
                <SpecRow icon={<Layers className="h-4 w-4" aria-hidden="true" />} label="Triangles">
                  {model?.printStats?.triangleCount ? model.printStats.triangleCount.toLocaleString() : '—'}
                </SpecRow>
                <SpecRow icon={<FileType className="h-4 w-4" aria-hidden="true" />} label="Formats">
                  <div className="flex flex-wrap gap-2">{fileFormatsToBadges(fileFormats)}</div>
                </SpecRow>
                <SpecRow icon={<BadgeCheck className="h-4 w-4" aria-hidden="true" />} label="Print Time">
                  {model?.printStats?.estimatedPrintTimeMinutes
                    ? `${Math.round(model.printStats.estimatedPrintTimeMinutes)} min`
                    : '—'}
                </SpecRow>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <ShieldCheck className="h-4 w-4 text-sky-400" aria-hidden="true" />
                License Information
              </div>
              <p className="mt-2 text-sm text-slate-300">
                This asset is provided under the <span className="font-semibold text-sky-300">{license}</span>. Please refer to your creator agreement for detailed usage rights.
              </p>
            </div>
          </div>

          <div className="sticky bottom-0 flex gap-3 border-t border-white/10 bg-slate-900/95 px-6 py-4">
            <button
              type="button"
              disabled
              className="flex-1 rounded-md bg-emerald-500/20 px-4 py-3 text-sm font-semibold text-emerald-200 opacity-80"
            >
              Added to Collection
            </button>
            <button
              type="button"
              onClick={handlePlace}
              disabled={!model}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-sky-500/70 bg-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-sky-500"
            >
              <PackagePlus className="h-4 w-4" aria-hidden="true" /> Add to Basket &amp; Place
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function SpecRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-sky-300">{icon}</div>
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
        <div className="text-sm text-slate-200">{children}</div>
      </div>
    </div>
  )
}

function formatDimension(value?: number) {
  if (!value) return '—'
  const metres = value > 10 ? value / 1000 : value
  return metres.toFixed(2)
}
