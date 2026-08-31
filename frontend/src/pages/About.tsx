import React from 'react'
import { Link } from 'react-router-dom'
import Seo from '../components/common/Seo'

const About: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Seo
        title="About Us"
        description="Artifact Armoury is a marketplace and free 3D planner for tabletop terrain. Buy print-ready STL models from independent artists, plan your table before you print, and sell your own work with anti-theft protection built in."
        path="/about"
      />
      <h1 className="text-2xl font-semibold">About Artifact Armoury</h1>
      <p className="text-muted-foreground mt-3 leading-relaxed">
        Artifact Armoury is a marketplace and planning tool for 3D-printable
        tabletop terrain. Buyers browse and purchase STL models from independent
        artists, lay out a whole gaming table in our 3D planner, and download
        print-ready files. Artists get a storefront, and their work is protected
        against theft and re-upload.
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">For players &amp; hobbyists</h2>
        <ul className="mt-3 space-y-2 text-muted-foreground leading-relaxed list-disc pl-5">
          <li>
            Browse a growing catalogue of buildings, scatter, nature and complete
            sets, filtered by type, era, scale and condition.
          </li>
          <li>
            Design your battlefield in the{' '}
            <Link to="/planner" className="text-primary hover:underline">
              full-screen 3D planner
            </Link>
            — drag pieces onto a grid, stack and rotate them, then push the whole
            build into your cart in one click.
          </li>
          <li>
            Buy an STL <strong>once</strong> and print it as many times as you
            like. Multi-part “set” models download as a single ZIP.
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">For artists</h2>
        <ul className="mt-3 space-y-2 text-muted-foreground leading-relaxed list-disc pl-5">
          <li>
            Upload your STLs and we generate a 3D preview and print estimate
            automatically — no manual conversion needed.
          </li>
          <li>
            Group related models into <strong>bundles</strong> at a single price,
            and sell multi-part sets as one listing.
          </li>
          <li>
            Track sales and engagement from your artist dashboard.
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Protecting creators</h2>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          Every file a buyer downloads carries an invisible, per-buyer watermark,
          so a leaked STL can be traced back to the exact purchase without
          altering the printable geometry. We also fingerprint the shape of every
          upload — rotation, scale and re-export resistant — so stolen models
          can’t be quietly re-listed by someone else.
        </p>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          <Link to="/creator-protection" className="text-primary hover:underline">
            Read how we protect your models
          </Link>{' '}
          — what each measure does, and what it deliberately doesn’t claim to do.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Questions?</h2>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          Head to your dashboard to start uploading or planning, or{' '}
          <Link to="/contact" className="text-primary hover:underline">
            contact us
          </Link>{' '}
          — we typically reply within a day or two.
        </p>
      </section>
    </div>
  )
}

export default About
