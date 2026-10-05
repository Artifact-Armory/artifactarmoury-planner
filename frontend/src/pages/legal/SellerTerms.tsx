import React from 'react'
import { Link } from 'react-router-dom'
import LegalLayout, { LegalSection } from './LegalLayout'

/**
 * Seller Terms: what an artist agrees to when they redeem an invite code
 * (RedeemArtistInvite.tsx). The version recorded against each acceptance is
 * SELLER_TERMS_VERSION in backend/src/services/artistOnboarding.ts. Bump it in the
 * same commit whenever this text materially changes.
 *
 * Every figure here must match the code: share (users.commission_rate, default 85),
 * payout hold (PAYOUT_HOLD_DAYS, 21) and minimum payout (MIN_PAYOUT_GBP, 10).
 */
const SellerTerms: React.FC = () => {
  return (
    <LegalLayout title="Seller Terms" updated="5 October 2026">
      <LegalSection heading="1. Who we are and what you are agreeing to">
        <p>
          Artifact Armoury (“we”, “us”) is operated by Artifact Armoury Ltd, registered at
          Unit A, 82 James Carter Road, Mildenhall, IP28 7DE. These terms apply to you
          (“you”, “the artist”) if you sell on Artifact Armoury. They sit alongside our{' '}
          <Link to="/terms-of-service" className="text-primary underline">Terms of Service</Link>{' '}
          and{' '}
          <Link to="/privacy-policy" className="text-primary underline">Privacy Policy</Link>.
          If they conflict, these Seller Terms win for anything to do with selling.
        </p>
        <p>
          Selling is by invitation. An invite code is single use and cannot be transferred.
          By redeeming one and creating a seller account you agree to these terms.
        </p>
      </LegalSection>

      <LegalSection heading="2. Your account">
        <p>
          You must give accurate information, keep it up to date, and keep your login
          secure. Two-factor authentication is required before you can upload a model,
          publish a bundle or connect payouts. You are responsible for everything done
          through your account.
        </p>
      </LegalSection>

      <LegalSection heading="3. Your work and your rights">
        <p>
          You keep ownership of your designs and of the intellectual property in them. By
          listing a model you confirm that:
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>you created it, or you have the right to sell it, and it does not infringe anyone else’s intellectual property, trademarks or licence terms, including games publishers’ rights;</li>
          <li>if it uses licensed or third-party material, you have the right to sell it as a digital file on the terms you set;</li>
          <li>your listing, images and description accurately show what the buyer will receive.</li>
        </ul>
        <p>
          You grant us a non-exclusive, worldwide licence, for as long as the model is
          listed and for as long as buyers are entitled to download it, to host, process,
          convert, preview, watermark, display and deliver your files, and to use your store
          name, images and descriptions to promote the marketplace and your listings. You
          can ask us to stop using your images for promotion at any time, but we need to
          keep delivering files to people who have already bought them.
        </p>
      </LegalSection>

      <LegalSection heading="4. Listings and the licence buyers get">
        <p>
          You set your own prices, in pounds and before VAT, and choose the licence on each
          listing: personal use only, or commercial use (the buyer may sell physical prints
          they make themselves). Both licences forbid redistributing the digital files. A
          buyer buys each model once and may then print as many copies as the licence
          allows.
        </p>
      </LegalSection>

      <LegalSection heading="5. Fees and your share of each sale">
        <p>
          You keep a set share of the <strong>net price</strong> of each sale (the price
          after any discount, before VAT), and we keep the rest. The standard share is
          currently <strong>85%</strong>. Your share is set per account, and we will tell
          you if it changes for you. If we offer an introductory rate we will tell you when
          it applies and when it ends. VAT is added on top for buyers. We collect it, and it
          does not come out of your share.
        </p>
        <p>
          <strong>Discounts.</strong> If you run a public sale, the discount is shared
          between you and us in proportion to our shares of the sale price. If you create a
          promo code, <strong>the whole cost of the discount comes out of your share, not
          ours.</strong> A discount can never take an item below the minimum price we set
          for it.
        </p>
      </LegalSection>

      <LegalSection heading="6. Getting paid">
        <p>
          Payouts are made through Stripe Connect, so you must complete Stripe’s
          verification to be paid. Earnings become eligible for payout after a holding
          period, currently <strong>21 days</strong>, and we pay out once your eligible
          balance reaches the minimum, currently <strong>£10</strong>. Stripe may charge its
          own fees or hold funds under its own rules, and we are not responsible for
          Stripe’s decisions. You are responsible for your own tax, including declaring and
          paying tax on what you earn.
        </p>
      </LegalSection>

      <LegalSection heading="7. Refunds and disputes">
        <p>
          If a buyer is refunded, the refunded amount comes out of your earnings for that
          sale. If that money has not been paid out to you yet, we simply do not pay it. We
          may refund a buyer where a file is faulty, corrupt or not as described, or where a
          listing is removed for breaching these terms. We will tell you when we do.
        </p>
      </LegalSection>

      <LegalSection heading="8. Protection of your files">
        <p>
          We protect your files in the ways described on our{' '}
          <Link to="/creator-protection" className="text-primary underline">Creator Protection</Link>{' '}
          page: per-buyer watermarking of every download, shape fingerprinting of every
          upload, and previews that cannot be printed. These measures make theft traceable
          and hard. <strong>They do not make it impossible, and we do not guarantee that
          your work will never be copied or shared.</strong> If you find your work being
          shared, tell us and we will investigate, act on the account involved where we can
          trace it, and support your takedown request.
        </p>
      </LegalSection>

      <LegalSection heading="9. Duplicates and your own files">
        <p>
          We check every upload against the whole marketplace. A match against another
          artist’s work is rejected. You can upload your own file as many times as you like,
          for example to sell it on its own and inside a set. If you believe we have wrongly
          rejected a file, contact us and we will review it.
        </p>
      </LegalSection>

      <LegalSection heading="10. Deleting or unpublishing a listing">
        <p>
          You can unpublish or delete a listing at any time. Deleting removes it from the
          store, but <strong>people who already bought it keep their access to download
          it.</strong> We keep the file hash and shape fingerprint of deleted listings so
          the design stays protected.
        </p>
      </LegalSection>

      <LegalSection heading="11. Rules for sellers">
        <p>
          You must not: upload anything unlawful, infringing, hateful or misleading; copy
          another artist’s work; manipulate reviews, sales or analytics; try to take buyers
          off the platform to avoid our fee; share or resell files you have bought from
          others; or try to defeat our security, watermarking or fingerprinting. You must
          reply to buyer messages promptly and deal with problems fairly.
        </p>
      </LegalSection>

      <LegalSection heading="12. What we can do">
        <p>
          We may unpublish or remove any listing, refuse or reverse a sale, withhold
          payouts while we investigate, suspend or close an account, and report matters to
          the authorities, where we reasonably believe you have broken these terms, the law,
          or someone else’s rights. Where we reasonably can, we will tell you why.
        </p>
      </LegalSection>

      <LegalSection heading="13. Ending this agreement">
        <p>
          You can close your seller account at any time. Buyers keep their downloads. We
          will pay out any earnings you are owed, less anything we are entitled to keep
          under these terms. We can end your access with notice, or immediately for serious
          breach.
        </p>
      </LegalSection>

      <LegalSection heading="14. Liability">
        <p>
          We provide the marketplace “as is”. We do not guarantee any level of sales.
          Nothing in these terms limits liability that cannot lawfully be limited, including
          for death or personal injury caused by negligence, or for fraud. Subject to that,
          our total liability to you is limited to the amount we paid or owed to you in the
          12 months before the claim.
        </p>
      </LegalSection>

      <LegalSection heading="15. Changes, law and contact">
        <p>
          We may update these terms. If we make a material change we will tell you through
          the site or by email, and you will be asked to accept the new version before you
          carry on selling. These terms are governed by the laws of England and Wales, and
          the courts of England and Wales have jurisdiction. Questions:{' '}
          <a href="mailto:support@artifactarmoury.com" className="text-primary underline">
            support@artifactarmoury.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  )
}

export default SellerTerms
