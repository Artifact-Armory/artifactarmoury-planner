import React from 'react'
import { Link } from 'react-router-dom'
import Button from '../../components/ui/Button'
import Seo from '../../components/common/Seo'
import { SITE_NAME } from '../../config/brand'

const ArtistApplication: React.FC = () => {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* Behind ProtectedRoute (sign-in required), so a crawler can never actually
          reach this content — noindex rather than let it index a login wall. */}
      <Seo title="Become an Artist" noindex />
      <section className="rounded-3xl bg-card p-8 shadow-sm">
        <h1 className="text-3xl font-semibold text-foreground">Become an {SITE_NAME} artist</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          We&apos;re building a curated marketplace of terrain makers. Submit your portfolio and we&apos;ll send an invite code
          if there&apos;s a good fit. Artists keep 80% of every sale and gain access to advanced analytics and customer
          messaging.
        </p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-primary/20 bg-primary/10 p-5">
            <h2 className="text-sm font-semibold text-primary">What we look for</h2>
            <ul className="mt-3 space-y-2 text-sm text-primary/80">
              <li>• Original or licensed 3D terrain with consistent quality</li>
              <li>• At least 8 high-resolution renders or photos</li>
              <li>• Layered STL or resin-friendly meshes</li>
              <li>• Ability to respond to customer messages within 48 hours</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-border bg-muted p-5">
            <h2 className="text-sm font-semibold text-foreground">How to apply</h2>
            <ol className="mt-3 space-y-2 text-sm text-foreground">
              <li>1. Prepare a PDF portfolio or public gallery link</li>
              <li>2. Include links to social profiles or storefronts (if any)</li>
              <li>3. Email everything to <span className="font-medium">artists@artifactarmoury.com</span></li>
            </ol>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">
            How we look after your files
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Visitors browsing the site never receive your real model — they see a low-detail
            stand-in that can&apos;t be printed. Each buyer&apos;s download is prepared
            individually, so if a file ever turns up where it shouldn&apos;t, we can tell you
            which sale it came from. And every new upload is checked against the whole
            marketplace, so nobody can re-list your work as their own.
          </p>
          <Link
            to="/creator-protection"
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
          >
            The full detail, including what we don&apos;t claim →
          </Link>
        </div>

        <div className="mt-8 rounded-2xl border border-dashed border-border bg-muted p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Have an invite code already?</p>
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
