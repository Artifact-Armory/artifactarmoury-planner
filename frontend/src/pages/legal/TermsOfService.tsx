import React from 'react'
import { Link } from 'react-router-dom'
import LegalLayout, { LegalSection } from './LegalLayout'

const TermsOfService: React.FC = () => {
  return (
    <LegalLayout title="Terms of Service" updated="12 July 2026">
      <LegalSection heading="1. Who we are">
        <p>
          Artifact Armoury (“we”, “us”) is an online marketplace where independent
          creators (“artists”) sell digital 3D-printable models and buyers download them
          to print themselves. By creating an account or using the site you agree to these
          terms.
        </p>
      </LegalSection>

      <LegalSection heading="2. What you are buying">
        <p>
          Purchases on Artifact Armoury are <strong>digital downloads</strong> — one or
          more 3D model files (typically STL). You are buying a <strong>licence to use the
          files</strong>, not the copyright in the design. Ownership of the design and all
          intellectual property remains with the artist.
        </p>
        <p>
          You buy each model <strong>once</strong> and may then download it and print as
          many physical copies as your licence permits. There is no per-print charge.
        </p>
      </LegalSection>

      <LegalSection heading="3. Your licence to use a model">
        <p>Each listing states one of two licences. Unless the listing says otherwise:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Personal use</strong> — you may print the model as many times as you
            like for your own personal, non-commercial use. You may <em>not</em> sell the
            printed items.
          </li>
          <li>
            <strong>Commercial use</strong> — you may print the model and sell the physical
            prints you produce yourself.
          </li>
        </ul>
        <p>
          <strong>Both licences prohibit</strong> sharing, re-selling, uploading or
          otherwise redistributing the digital files themselves, and prohibit using them to
          create a competing digital product. The licence is personal to your account and
          is not transferable.
        </p>
      </LegalSection>

      <LegalSection heading="4. Anti-piracy watermarking">
        <p>
          To protect artists, every file you download is <strong>individually
          watermarked</strong> with an encrypted code tied to your account and order. This
          does not affect the printed result, but it means a file that is leaked or shared
          in breach of these terms can be traced back to the account that downloaded it.
          Removing, tampering with or attempting to defeat the watermark is a breach of
          these terms. See our{' '}
          <Link to="/privacy-policy" className="text-indigo-600 underline">Privacy Policy</Link>{' '}
          for how this data is handled.
        </p>
      </LegalSection>

      <LegalSection heading="5. Refunds and your right to cancel">
        <p>
          Because our products are digital files delivered immediately, they are treated as
          digital content under UK/EU consumer law. When you buy a model you are asked to
          agree that your download begins immediately and that, by doing so, you{' '}
          <strong>lose the 14-day right to cancel</strong> once the download has started.
        </p>
        <p>
          We still want you to be happy with your purchase. If a file is faulty, corrupt,
          not as described, or you have not yet downloaded it, contact us or the artist
          through your dashboard and we will help put it right — including a refund where
          appropriate. Disputes are handled artist-first through our messaging system, with
          our support team stepping in if needed.
        </p>
      </LegalSection>

      <LegalSection heading="6. Selling on Artifact Armoury">
        <p>By listing a model as an artist you confirm that:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>you own or have the rights to sell the design, and it does not infringe anyone else’s intellectual property;</li>
          <li>the files are your own work and are not re-uploads of another creator’s model;</li>
          <li>the listing, images and description accurately represent what the buyer will receive;</li>
          <li>you grant buyers the licence stated on the listing, and grant us the limited rights needed to host, process, watermark and deliver your files.</li>
        </ul>
        <p>
          We operate a re-upload detection and moderation system and may unpublish or remove
          content, and suspend accounts, that breach these terms or others’ rights.
        </p>
      </LegalSection>

      <LegalSection heading="7. Prohibited use">
        <p>
          You may not use the site to infringe intellectual property, upload unlawful or
          infringing content, circumvent our security or watermarking, scrape or bulk-download
          content, or resell access to the platform.
        </p>
      </LegalSection>

      <LegalSection heading="8. Liability">
        <p>
          Models are supplied “as is”. We do not guarantee that any file will print
          successfully on your particular printer or settings. Nothing in these terms limits
          liability that cannot lawfully be limited (including for death or personal injury
          caused by negligence, or fraud).
        </p>
      </LegalSection>

      <LegalSection heading="9. Changes and contact">
        <p>
          We may update these terms; material changes will be notified through the site. For
          any questions about these terms, contact us at{' '}
          <a href="mailto:support@artifactplanner.com" className="text-indigo-600 underline">
            support@artifactplanner.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  )
}

export default TermsOfService
