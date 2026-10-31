import React from 'react'
import { Link } from 'react-router-dom'
import LegalLayout, { LegalSection } from './LegalLayout'

/**
 * Acceptable Use Policy: what may and may not be sold or done on the site. Applies to
 * buyers and sellers alike; TermsOfService.tsx (section 8) and SellerTerms.tsx
 * (section 12) point here. Written for PayPal onboarding (Oct 2026), so keep the
 * prohibited-items list at least as strict as the payment providers' own rules.
 * Consequences must match what admin moderation can actually do (resolveReport in
 * backend/src/routes/admin.ts) and Seller Terms sections 7, 13 and 14.
 */
const AcceptableUse: React.FC = () => {
  return (
    <LegalLayout title="Acceptable Use Policy" updated="29 October 2026">
      <LegalSection heading="1. About this policy">
        <p>
          This policy sets out what can and cannot be sold, bought or done on Artifact
          Armoury, which is run by Artifact Armoury Ltd (company number 16510100),
          registered at Unit A, 82 James Carter Road, Mildenhall, IP28 7DE. It applies to
          everyone who uses the site, including buyers and artists who sell with us. It
          forms part of our <Link to="/terms-of-service" className="text-primary underline">Terms of Service</Link>{' '}
          and <Link to="/seller-terms" className="text-primary underline">Seller Terms</Link>.
        </p>
      </LegalSection>

      <LegalSection heading="2. What can be sold">
        <p>
          Artifact Armoury is a marketplace for <strong>digital 3D-printable model files</strong>{' '}
          for tabletop gaming and the hobby: terrain, scenery, buildings, vehicles,
          miniatures, bases and accessories, and similar models for display. Only approved
          artists can sell, and they may only sell designs they created or have the right
          to sell.
        </p>
        <p>
          Artists may include supporting files with their models, such as PDF print
          guides, assembly instructions and images. Artists may not use the site to sell
          physical goods, services, gift cards or digital currency, or anything other than
          3D model files and their supporting files, unless it is a feature we offer on the
          site ourselves.
        </p>
      </LegalSection>

      <LegalSection heading="3. Prohibited items">
        <p>You must not list, sell, upload or share files for any of the following:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Weapons and weapon parts</strong>: firearms, or any working or
            functional part, frame, receiver, magazine, suppressor, conversion kit or
            accessory for a real firearm; ammunition; explosives; and real working
            weapons such as knives, blades, knuckle-dusters or crossbows. Scale models of
            weapons for gaming and display (for example a soldier's rifle or a tank's gun on
            a miniature) are allowed.
          </li>
          <li>
            <strong>Items that infringe someone else's rights</strong>: copies or
            recreations of another artist's or company's designs, official miniatures or
            other protected models, and anything using trade marks, logos or characters you
            do not have permission to use.
          </li>
          <li>
            <strong>Sexually explicit or adult content</strong>, including nudity
            intended to be sexual, and any content that sexualises minors.
          </li>
          <li>
            <strong>Hate and extremism</strong>: content that promotes hatred, violence or
            discrimination against people based on race, ethnicity, religion, disability,
            sex, sexual orientation or gender identity, or that glorifies extremist,
            terrorist or hate groups. Historically accurate military models for wargaming
            are allowed, but not items that glorify such groups, such as symbols or
            memorabilia made to celebrate them.
          </li>
          <li>
            <strong>Drugs and drug paraphernalia</strong>, including pipes, grinders and
            other items designed for using illegal drugs.
          </li>
          <li>
            <strong>Items used to commit crime or fraud</strong>: replica documents, IDs,
            banknotes, coins or official seals; lock-picking or skimming devices; and
            anything designed to help break the law.
          </li>
          <li>
            <strong>Unsafe items presented as safe</strong>: files sold as food-safe,
            medical, child-safe or safety equipment.
          </li>
          <li>
            <strong>Misleading listings</strong>: listings whose images, description, scale
            or licence do not match the files supplied, or that use renders or photos of
            someone else's work.
          </li>
          <li>
            <strong>Anything else that is unlawful</strong> in the UK, or in the buyer's or
            seller's country, or that our payment providers do not allow.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. Prohibited behaviour">
        <p>Whether you buy or sell, you must not:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>use stolen payment details, or commit or attempt fraud, including fake purchases or chargeback abuse;</li>
          <li>use the site to launder money, or to deal with anyone subject to sanctions;</li>
          <li>share, resell or upload files you have bought from others, or upload files you do not own;</li>
          <li>remove, alter or try to defeat our watermarking, fingerprinting or other security;</li>
          <li>scrape, bulk-download or copy content from the site;</li>
          <li>fake or manipulate reviews, ratings, sales or analytics;</li>
          <li>take buyers off the site to pay outside Artifact Armoury;</li>
          <li>harass, threaten or abuse anyone, or send spam;</li>
          <li>open more than one account to get around a suspension or ban;</li>
          <li>file false or malicious reports against other users.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="5. How we check">
        <ul className="ml-5 list-disc space-y-1">
          <li>Every artist is reviewed and approved by us before they can list anything. Artists paid through Stripe must pass Stripe's identity checks before being paid, and we check the identity and payment details of any artist we pay directly by PayPal or bank transfer.</li>
          <li>Every uploaded file is checked against our catalogue for copies of other artists' work, and matches are reviewed by our team.</li>
          <li>Every file is watermarked to the buyer and order, so leaked files can be traced.</li>
          <li>Anyone can report a listing using the report button on its page, or by emailing support@artifactarmoury.com. Our team reviews every report.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. What happens if this policy is broken">
        <p>
          Depending on how serious the breach is, we may do one or more of the following:
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>give a formal warning;</li>
          <li>unpublish, flag or permanently remove a listing (a listing removed by us cannot be republished);</li>
          <li>refund the buyers of a listing and cancel the seller's unpaid earnings from it;</li>
          <li>withhold payouts while we investigate;</li>
          <li>restrict, suspend or permanently close an account;</li>
          <li>report the matter to the police, other authorities or our payment providers.</li>
        </ul>
        <p>
          Sellers will be told our reasons by email and can ask us to review the decision,
          as set out in the Seller Terms. If you think something on the site breaks this
          policy, please report it.
        </p>
      </LegalSection>

      <LegalSection heading="7. Changes">
        <p>
          We may update this policy, for example to follow the law or our payment
          providers' rules. The date at the top shows when it last changed. Questions go
          to support@artifactarmoury.com.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}

export default AcceptableUse
