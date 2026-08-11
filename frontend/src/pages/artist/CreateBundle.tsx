import React from 'react'
import { useNavigate } from 'react-router-dom'
import BundleForm, { BundleFormValues } from './BundleForm'
import { bundlesApi } from '../../api/endpoints/bundles'

const CreateBundle: React.FC = () => {
  const navigate = useNavigate()

  async function handleSave(values: BundleFormValues) {
    const created = await bundlesApi.create(values)
    // Land on the edit page so the artist can add a thumbnail / publish.
    navigate(`/artist/bundles/${created.id}/edit`)
  }

  return (
    <div className="px-4 py-10 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold">Create Bundle</h1>
      <p className="text-muted-foreground mt-1">
        Group several of your models under one name and one price. Buyers pay once and can
        download every STL in the bundle.
      </p>
      <BundleForm submitLabel="Create bundle" onSave={handleSave} />
    </div>
  )
}

export default CreateBundle
