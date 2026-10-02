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
        Artifact Armoury is a marketplace for 3D-printable tabletop terrain,
        vehicles and characters, with a table planner that lets you build your
        table before you buy.
      </p>
      <p className="text-muted-foreground mt-3 leading-relaxed">
        I've always loved building detailed, immersive wargaming tables, but
        photos of individual models made it hard to tell whether I could pull a
        cohesive scene together. Trying pieces out on a virtual table changed
        that. I could design the environments I actually wanted before spending
        anything. I built Artifact Armoury so other players can do the same, and
        so the artists behind the models get paid fairly and have their work
        protected.
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">For players &amp; hobbyists</h2>
        <ul className="mt-3 space-y-2 text-muted-foreground leading-relaxed list-disc pl-5">
          <li>
            Browse terrain, vehicles and characters, filtered by type, era,
            scale and condition.
          </li>
          <li>
            Lay out your whole table in the{' '}
            <Link to="/planner" className="text-primary hover:underline">
              table planner
            </Link>
            . Stack and rotate pieces, then add everything to your basket in one
            click. No account needed to plan.
          </li>
          <li>
            Buy a model <strong>once</strong> and print it as often as you like.
            Each listing says whether you may sell your prints or keep them for
            personal use.
          </li>
          <li>Multi-part sets download as a single ZIP.</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">For artists</h2>
        <ul className="mt-3 space-y-2 text-muted-foreground leading-relaxed list-disc pl-5">
          <li>
            Upload STL, OBJ or 3MF files and we generate the 3D preview
            automatically.
          </li>
          <li>
            Sell single models, multi-part sets, or bundles of several models at
            one price.
          </li>
          <li>
            Keep 85% of every sale. Track sales and engagement from your artist
            dashboard.
          </li>
          <li>
            Preview models are simplified and altered so they can't be printed,
            and every download is watermarked to the buyer.
          </li>
          <li>
            Sharing or reselling purchased files breaks our terms, and we will
            suspend or ban accounts that do it.
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Becoming an artist here</h2>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          Artifact Armoury is a curated marketplace, so artists apply before they
          can sell. Send us your portfolio and our team reviews your catalogue.
          If it's a good fit, we send you an invite code to open your artist
          account. It keeps the quality high for buyers and the marketplace fair
          for the artists already here.{' '}
          <Link to="/apply-artist" className="text-primary hover:underline">
            Apply to sell
          </Link>
          .
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">How we protect artists' work</h2>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          Piracy is the main reason good artists don't sell STLs online, so we
          built protection in from the start.
        </p>
        <ul className="mt-3 space-y-2 text-muted-foreground leading-relaxed list-disc pl-5">
          <li>
            <strong>Watermarking.</strong> Every file a buyer downloads carries
            an invisible watermark unique to that purchase. If a file leaks, we
            can trace it to the order it came from. The printable geometry isn't
            changed.
          </li>
          <li>
            <strong>Fingerprinting.</strong> We fingerprint the shape of every
            upload, and the match survives rotation, rescaling and re-exporting.
            If someone re-lists another artist's model, we can detect it.
          </li>
        </ul>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          Neither measure makes theft impossible. They make it traceable and
          easy to spot.{' '}
          <Link to="/creator-protection" className="text-primary hover:underline">
            Read how we protect your models
          </Link>{' '}
          for what each one does and what it deliberately doesn't claim to do.
        </p>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          Plenty of terrain looks alike because the genre calls for it: castle
          towers have battlements, ruined houses have broken walls. Sharing a
          common style isn't copying. We only act on models that are copies of
          another artist's file or design, not on pieces that happen to look
          similar.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">What buyers should know</h2>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          The watermark links each file to your account and the order it came
          from. If you share your files publicly, they can be traced back to your
          purchase.
        </p>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          We remove models that copy other people's or publishers' designs. If
          you spot one, use the “Report this model” button on its page.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Questions?</h2>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          <Link to="/contact" className="text-primary hover:underline">
            Contact us
          </Link>{' '}
          and we typically reply within a day or two. Artists can apply to sell
          from the{' '}
          <Link to="/apply-artist" className="text-primary hover:underline">
            artist application page
          </Link>
          .
        </p>
        <p className="text-muted-foreground mt-6 text-sm leading-relaxed italic">
          Artifact Armoury is an independent marketplace and is not affiliated
          with, endorsed by, or sponsored by any game publisher. All game and
          product names are trademarks or registered trademarks of their
          respective owners, used only to describe scale and compatibility.
        </p>
      </section>
    </div>
  )
}

export default About
