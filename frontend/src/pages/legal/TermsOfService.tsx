import React from 'react'
import { Link } from 'react-router-dom'
import LegalLayout, { LegalSection } from './LegalLayout'

/**
 * Buyer terms. Keep consistent with SellerTerms.tsx and PrivacyPolicy.tsx, and with what
 * checkout actually does (Checkout.tsx: separate immediate-supply consent checkbox;
 * orders.ts stamps terms_accepted_at / download_consent_at; the confirmation email
 * repeats the consent). Bump the version and date together when this text changes.
 */
const TermsOfService: React.FC = () => {
  return (
    <LegalLayout title="Terms of Service" updated="5 October 2026">
      <LegalSection heading="1. Who we are, and who you are buying from">
        <p>
          Artifact Armoury is operated by <strong>Artifact Armoury Ltd</strong>, registered
          at Unit A, 82 James Carter Road, Mildenhall, IP28 7DE (“we”, “us”). It is an
          online marketplace where independent creators (“artists”) list digital
          3D-printable models and buyers download them to print themselves. By creating an
          account or using the site you agree to these terms.
        </p>
        <p>
          <strong>When you buy a model, you are buying from Artifact Armoury Ltd.</strong>{' '}
          We set these terms, take your payment, deliver the files and handle refunds and
          complaints. The artist (or the rights holder they sell for) owns the design and
          grants you the licence in section 3 through us. We owe you the statutory remedies
          in section 5 for what we supply, and our support team can decide refunds and
          other remedies on any order. We pay the artist their share from what you pay.
        </p>
      </LegalSection>

      <LegalSection heading="2. What you are buying">
        <p>
          Purchases are <strong>digital downloads</strong>: one or more 3D model files
          (typically STL). You are buying a <strong>licence to use the files</strong>, not
          the copyright in the design. Ownership of the design and all intellectual property
          remains with the artist or the relevant rights holder.
        </p>
        <p>
          You buy each model <strong>once</strong> and may then download it and print as
          many physical copies as the licence allows. There is no per-print charge. Prices
          shown include VAT where it applies to you; the VAT is itemised at checkout.
        </p>
      </LegalSection>

      <LegalSection heading="3. Your licence to use a model">
        <p>
          Each listing states one of two licences, and the wording below is the licence that
          applies. A listing cannot change it. The licence starts when your payment clears,
          lasts for as long as the model exists, and applies to the account that bought it.
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Personal use</strong> — you may print the model as many times as you
            like for your own personal, non-commercial use, and give printed copies to
            others as non-commercial gifts. You may <em>not</em> sell printed items.
          </li>
          <li>
            <strong>Commercial use</strong> — as above, and you may also sell the physical
            prints you produce. If you are a business, you may have your own employees or a
            printing contractor produce prints for you, provided the files are used only to
            make prints for you and are not passed on or kept by them for any other purpose.
          </li>
        </ul>
        <p>
          <strong>For both licences</strong> you may keep backups of the files, convert
          them to other formats, and repair, scale, split, rotate or otherwise modify them
          for your own printing. You may not share, re-sell, upload or otherwise
          redistribute the digital files (modified or not), or use them to create a
          competing digital product. The licence is personal to your account and cannot be
          transferred; a business may buy under its own account. If a licence ends for the
          reasons in section 4 or 7, you must stop making new prints from the affected
          model, but you may keep and sell prints you made while it was valid.
        </p>
      </LegalSection>

      <LegalSection heading="4. Anti-piracy watermarking">
        <p>
          To protect artists, files we deliver are <strong>individually watermarked</strong>{' '}
          with an encrypted identifier tied to your account and order. The identifier is
          stored in part of the file that is not used when printing, and is designed not to
          change the printed result. If a file is leaked, the identifier shows which
          download it came from. That is a starting point for an investigation, not proof
          of who leaked it: we will consider other explanations, such as a compromised
          account, before acting.
        </p>
        <p>
          You must not deliberately remove, alter or defeat the watermark. Ordinary slicing,
          repair, scaling or format conversion is not a breach. If we find that you have
          shared, uploaded or resold files you bought, we may take the steps in section 7.
          See our{' '}
          <Link to="/privacy-policy" className="text-primary underline">Privacy Policy</Link>{' '}
          for how this data is handled.
        </p>
      </LegalSection>

      <LegalSection heading="5. Cancelling, faulty files and refunds">
        <p>
          <strong>Your right to cancel.</strong> Digital content you buy from a distance
          normally carries a 14-day right to cancel. At checkout there is a separate,
          unticked box asking you to consent expressly to immediate supply and to
          acknowledge that you lose that right once supply begins. If you tick it and we
          begin supplying (your download becomes available as soon as payment is
          confirmed), you can no longer cancel. If you do not tick it, you cannot complete
          the purchase. We confirm your consent in your order confirmation email.
        </p>
        <p>
          <strong>Your statutory rights.</strong> Losing the right to cancel does not affect
          your rights if something is wrong. Where consumer law applies, digital content
          must be of satisfactory quality, fit for a particular purpose you made known to
          us, and as described. If it is not, you may be entitled to repair or replacement,
          a price reduction or a refund, depending on the circumstances.
        </p>
        <p>
          <strong>Our process.</strong> If you have a problem, contact the artist through
          your dashboard or contact us at{' '}
          <a href="mailto:support@artifactarmoury.com" className="text-primary underline">
            support@artifactarmoury.com
          </a>
          . Raising it with the artist first is optional and never a condition of using your
          legal rights. We may also offer refunds beyond what the law requires; those are
          goodwill decisions and do not limit your statutory rights.
        </p>
      </LegalSection>

      <LegalSection heading="6. Selling on Artifact Armoury">
        <p>
          Selling is also governed by our{' '}
          <Link to="/seller-terms" className="text-primary underline">Seller Terms</Link>,
          which cover fees, payouts and an artist’s responsibilities. By listing a model an
          artist confirms that:
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>they created it or have the right to sell it as a digital file, including the right to licence buyers and to let us host, process, watermark and deliver it, and it does not infringe anyone else’s rights;</li>
          <li>it is not a re-upload of another creator’s model without that creator’s permission;</li>
          <li>the listing, images and description accurately represent what the buyer will receive;</li>
          <li>they grant buyers the licence in section 3.</li>
        </ul>
        <p>
          We operate a re-upload detection and moderation system and may unpublish or remove
          content that breaches these terms or others’ rights.
        </p>
      </LegalSection>

      <LegalSection heading="7. Suspension, closure and your purchases">
        <p>
          We may suspend or close an account only where we reasonably believe it has been
          used to break these terms or the law, for example by sharing or reselling files,
          defeating the watermark, fraud, or a chargeback abuse pattern. We will use the
          least severe step that deals with the problem:
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li><strong>Temporary suspension</strong> while we investigate. We will email you the reason and you can ask us to review it by replying to that email.</li>
          <li><strong>Ending the licence for the affected model(s)</strong> where the breach concerns those files.</li>
          <li><strong>Permanent closure</strong> for serious or repeated breach. Licences for other models you bought are not ended just because of an unrelated breach, and you can still request a copy of those files for as long as we are lawfully able to supply them. If we close your account and you did nothing wrong, we will refund what you paid for anything you lose access to.</li>
        </ul>
        <p>
          Files you have already downloaded stay licensed under section 3 unless the licence
          for that model has ended. If a model is removed from the marketplace, or an artist
          closes their account, you keep your download access, except where we cannot
          lawfully keep supplying a file (for example because it infringes someone’s
          rights). In that case we will tell you and refund the price you paid for it.
        </p>
      </LegalSection>

      <LegalSection heading="8. Prohibited use">
        <p>
          You may not use the site to infringe intellectual property, upload unlawful or
          infringing content, circumvent our security or watermarking, scrape or bulk-download
          content, or resell access to the platform.
        </p>
      </LegalSection>

      <LegalSection heading="9. Printing results and liability">
        <p>
          How a file prints depends on your printer, materials and settings, which we cannot
          control, and we cannot promise it will print successfully on your equipment unless
          the listing says it is compatible. That does not limit your statutory rights in
          section 5, and a listing’s description of compatibility or features is binding on
          us. Nothing in these terms limits liability that cannot lawfully be limited
          (including for death or personal injury caused by negligence, fraud, or your
          statutory consumer rights).
        </p>
      </LegalSection>

      <LegalSection heading="10. Changes, law and contact">
        <p>
          We may change these terms to reflect changes in law, in how the marketplace works,
          or to correct or clarify them. We will email registered buyers about material
          changes and publish the new version with its date at least 14 days before it takes
          effect (sooner only where the law requires). New terms apply to future purchases
          and never reduce your rights under a purchase you have already made. If you do not
          accept a change, you can close your account before it takes effect.
        </p>
        <p>
          These terms are governed by the laws of England and Wales. If you live elsewhere in
          the UK or in the EU you also keep the mandatory consumer protections of your home
          country, and you may bring a claim in your local courts. Questions:{' '}
          <a href="mailto:support@artifactarmoury.com" className="text-primary underline">
            support@artifactarmoury.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  )
}

export default TermsOfService
