import React from 'react'
import Button from '../../components/ui/Button'

const ArtistApplication: React.FC = () => {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <section className="rounded-3xl bg-white p-8 shadow">
        <h1 className="text-3xl font-semibold text-gray-900">Become an Artifact Armoury artist</h1>
        <p className="mt-3 text-sm text-gray-600">
          We&apos;re building a curated marketplace of terrain makers. Submit your portfolio and we&apos;ll send an invite code
          if there&apos;s a good fit. Artists keep 80% of every sale and gain access to advanced analytics, customer
          messaging, and on-demand print fulfillment.
        </p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
            <h2 className="text-sm font-semibold text-indigo-900">What we look for</h2>
            <ul className="mt-3 space-y-2 text-sm text-indigo-900/80">
              <li>• Original or licensed 3D terrain with consistent quality</li>
              <li>• At least 8 high-resolution renders or photos</li>
              <li>• Layered STL or resin-friendly meshes</li>
              <li>• Ability to respond to customer messages within 48 hours</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
            <h2 className="text-sm font-semibold text-gray-900">How to apply</h2>
            <ol className="mt-3 space-y-2 text-sm text-gray-700">
              <li>1. Prepare a PDF portfolio or public gallery link</li>
              <li>2. Include links to social profiles or storefronts (if any)</li>
              <li>3. Mention your printing validation process</li>
              <li>4. Email everything to <span className="font-medium">artists@artifactarmoury.com</span></li>
            </ol>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
          <p className="font-medium text-gray-900">Have an invite code already?</p>
          <p className="mt-2">
            Use it during registration to unlock the artist dashboard immediately. Once approved you can set pricing,
            upload STL/GLB files, and schedule releases.
          </p>
        </div>

        <Button className="mt-8" variant="primary">
          Email the curation team
        </Button>
      </section>
    </div>
  )
}

export default ArtistApplication
