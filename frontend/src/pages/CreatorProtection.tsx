import React from 'react'
import { Link } from 'react-router-dom'
import {
  Fingerprint,
  ShieldCheck,
  EyeOff,
  Lock,
  Gauge,
  KeyRound,
  LifeBuoy,
  ScrollText,
} from 'lucide-react'
import Seo from '../components/common/Seo'
import { SITE_NAME } from '../config/brand'

/**
 * Artist-facing explanation of the anti-theft pipeline.
 *
 * IMPORTANT: every claim on this page must stay literally true of the code — an
 * artist who tests one and finds it hollow will trust none of the others. If a
 * protection changes, change this page in the same commit. The "what we do not
 * claim" section is deliberate: it is what makes the rest credible to a
 * technical reader. Do not replace it with marketing copy.
 *
 * Backed by: services/watermark.ts, services/fingerprint.ts,
 * services/proxyBake/*, routes/models.ts (download entitlement + preview
 * gating), middleware/security.ts (previewRateLimit).
 */

const Measure: React.FC<{
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}> = ({ icon, title, children }) => (
  <section className="rounded-2xl border border-border bg-card p-6">
    <div className="flex items-start gap-4">
      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">
          {children}
        </div>
      </div>
    </div>
  </section>
)

const CreatorProtection: React.FC = () => {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Seo
        title="How We Protect Your Models"
        description="Per-buyer watermarking, shape fingerprinting, and unprintable preview meshes: how Artifact Armoury protects artists' STL files from theft and re-upload, and what these protections don't claim to do."
        path="/creator-protection"
      />
      <p className="text-sm font-medium text-primary">For artists</p>
      <h1 className="mt-2 text-3xl font-semibold text-foreground">
        How we protect your models
      </h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        Handing your files to a marketplace is an act of trust. This page explains exactly
        what {SITE_NAME} does with them, in enough detail that you can judge it for
        yourself — including the things our protections deliberately do <em>not</em> try
        to do.
      </p>

      <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-5">
        <h2 className="text-sm font-semibold text-foreground">The short version</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>
            • Every downloaded file is invisibly marked to the individual buyer, so a leak
            can be traced back to the exact purchase.
          </li>
          <li>
            • The 3D preview a browser receives is a separate, deliberately unprintable
            stand-in. Your real print geometry is never sent to a visitor.
          </li>
          <li>
            • We fingerprint the <em>shape</em> of every upload, so nobody can re-list your
            model by rotating, rescaling or re-exporting it.
          </li>
          <li>• Your files download only to accounts that actually bought them.</li>
        </ul>
      </div>

      <div className="mt-8 space-y-4">
        <Measure
          icon={<ShieldCheck className="h-5 w-5" />}
          title="Every download is marked to one buyer"
        >
          <p>
            When someone downloads your model, we stamp an encrypted payload identifying
            the model, the buyer and the order into the file as it streams to them. Two
            buyers of the same model never receive byte-identical files.
          </p>
          <p>
            It is written into a region of the file that slicers ignore, so it adds no
            bytes and changes no geometry — <strong>the printed result is identical</strong>.
            The payload is authenticated: a forged or edited mark fails verification rather
            than pointing at an innocent buyer.
          </p>
          <p>
            If your model turns up somewhere it should not, send us the file and we can
            tell you which purchase it came from.
          </p>
        </Measure>

        <Measure icon={<EyeOff className="h-5 w-5" />} title="The preview is not your model">
          <p>
            Anything a browser can display, a determined person can capture — so we never
            send the real thing. The model shown on the site and in the planner is a
            separate proxy we generate: heavily simplified, with surface detail baked into
            texture maps rather than present as geometry, and with interior and underside
            faces removed so it is not a closed, watertight solid.
          </p>
          <p>
            Pulled out of the browser and dropped into a slicer, it fails. It looks right
            on screen and is worthless as a print — which is the point.
          </p>
        </Measure>

        <Measure
          icon={<Fingerprint className="h-5 w-5" />}
          title="Re-uploads are caught by shape, not filename"
        >
          <p>
            Every upload is measured into a fingerprint of its geometry that does not change
            when a file is rotated, rescaled, re-exported from other software, or has its
            triangles reordered. Renaming or re-saving a stolen file does not disguise it.
          </p>
          <p>
            New uploads are checked against every model <em>and every part of every set</em>{' '}
            already on the marketplace, and a match against another artist&apos;s work is
            rejected before it can be listed. You can still upload your own file as many
            times as you like — sold on its own and inside a set, for instance — because the
            check only blocks matches against <em>other</em> accounts.
          </p>
        </Measure>

        <Measure icon={<Lock className="h-5 w-5" />} title="Files are released only to buyers">
          <p>
            Downloads are authorised per request, on our servers: the account must be yours,
            or a buyer with a completed order for that model. There is no shareable download
            link to pass around, and none that keeps working after the fact.
          </p>
          <p>
            The storage locations of your original files never appear in any page, API
            response or preview — not even in a buyer&apos;s own purchase history.
          </p>
        </Measure>

        <Measure icon={<Gauge className="h-5 w-5" />} title="Bulk scraping is limited and visible">
          <p>
            Preview requests are rate-limited per visitor and per account. Ordinary browsing
            never comes close to the limit; a script trying to vacuum up the catalogue trips
            it and is logged for us to act on, so mass harvesting is a signal rather than a
            silent event.
          </p>
        </Measure>

        <Measure icon={<KeyRound className="h-5 w-5" />} title="Your selling account is locked down">
          <p>
            A seller account holds your catalogue and your earnings, so two-factor
            authentication is <strong>required</strong> — not merely offered — before you can
            upload a model, publish a bundle or connect payouts. It is enforced on our
            servers on every one of those actions, so someone who gets hold of your password
            still cannot list, alter or redirect anything.
          </p>
        </Measure>

        <Measure icon={<LifeBuoy className="h-5 w-5" />} title="If something does leak">
          <p>
            Send us the file — or a link to where it is being shared — through your artist
            dashboard. We identify the source purchase where the mark survives, act on the
            account involved, and support your takedown with what we find. If the mark has
            been stripped, the geometry fingerprint still shows the model is yours.
          </p>
        </Measure>
      </div>

      <section className="mt-8 rounded-2xl border border-border bg-muted p-6">
        <h2 className="text-base font-semibold text-foreground">What we do not claim</h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            No marketplace can make a digital file unstealable, and you should be sceptical
            of one that says otherwise. Our approach is the opposite: assume anything sent to
            a browser can be captured, then make what is capturable worthless and what is
            valuable traceable.
          </p>
          <p>
            So, plainly: we do not block right-clicking or try to disable browser developer
            tools. Those stop nobody who knows what they are doing, and get in the way of
            honest customers. Watermarking does not prevent a determined buyer from leaking a
            file — it removes their anonymity when they do. And nobody can stop someone
            sculpting their own copy from photographs.
          </p>
          <p>
            What we can promise is that the valuable file only ever reaches people who paid
            for it, that it carries their name when it does, and that we act when you tell us
            something is wrong.
          </p>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ScrollText className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Your work stays yours</h2>
            <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                You keep ownership of your designs. You set your prices and the licence
                buyers get, and you can unpublish or delete a listing at any time. We take
                only the limited rights needed to host, process, protect and deliver your
                files to the people who buy them — the detail is in the{' '}
                <Link to="/terms-of-service" className="text-primary hover:underline">
                  Terms of Service
                </Link>
                .
              </p>
              <p>
                Questions about any of this, or want something explained in more depth before
                you upload?{' '}
                <Link to="/contact" className="text-primary hover:underline">
                  Talk to us
                </Link>{' '}
                — we would rather answer them first.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default CreatorProtection
