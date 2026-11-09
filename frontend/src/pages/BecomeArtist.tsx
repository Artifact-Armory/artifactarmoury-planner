import React from 'react'
import { Link } from 'react-router-dom'
import Seo from '../components/common/Seo'
import { SITE_NAME } from '../config/brand'
import { useAuthStore } from '../store/authStore'

/**
 * Public guide to selling on the marketplace: account -> application -> selling,
 * a plain-English summary of the Seller Terms, and the site rules.
 *
 * Every figure here must match SellerTerms.tsx and the code: share 85%
 * (users.commission_rate), card fee 1.5% with founding artists (artist account
 * before 1 Nov 2026) exempt (services/cardFee.ts, not shown on this page by Callum's choice), 21-day hold (PAYOUT_HOLD_DAYS),
 * monthly payout on the 1st once £10+ (MIN_PAYOUT_GBP), 3 to 10 portfolio images
 * (ArtistApplicationForm.tsx). Update this page whenever the Seller Terms change.
 */

const DESCRIPTION =
  'Sell your 3D printable terrain, vehicles and miniatures on Artifact Armoury. How to apply, what you earn, how you get paid and the rules for sellers.'

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="mt-10">
    <h2 className="text-xl font-semibold text-foreground">{title}</h2>
    <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
  </section>
)

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <li className="flex gap-4 rounded-xl border border-border bg-card p-5">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
      {n}
    </span>
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-1 space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  </li>
)

const linkClass = 'font-medium text-primary hover:underline'

const BecomeArtist: React.FC = () => {
  const user = useAuthStore((s) => s.user)
  const isArtist = user?.role === 'artist' || user?.role === 'admin'

  const cta = isArtist ? (
    <Link
      to="/artist"
      className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
    >
      Go to your artist dashboard
    </Link>
  ) : (
    <Link
      to="/apply-artist"
      className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
    >
      Apply to be an artist
    </Link>
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Seo title="Become an Artist" description={DESCRIPTION} path="/become-an-artist" />

      <section className="rounded-3xl bg-card p-8 shadow-sm">
        <h1 className="text-3xl font-semibold text-foreground">Sell your models on {SITE_NAME}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {SITE_NAME} is a marketplace for 3D printable tabletop models. Buyers can try your models on a 3D
          table in our planner before they buy, and every file is protected against copying. You keep 85% of
          each sale and set your own prices.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {cta}
          {!user && (
            <Link
              to="/register"
              className="inline-flex items-center justify-center rounded-md border border-border px-6 py-3 text-sm font-semibold text-foreground hover:bg-muted"
            >
              Create an account
            </Link>
          )}
        </div>
      </section>

      <Section title="How to start selling">
        <ol className="space-y-3">
          <Step n={1} title="Create a free account">
            <p>
              <Link to="/register" className={linkClass}>Sign up</Link> with your email address, then click the
              link we email you to verify it. You need a verified email before you can upload models.
            </p>
          </Step>
          <Step n={2} title="Apply to be an artist">
            <p>
              Signed in, go to the <Link to="/apply-artist" className={linkClass}>artist application</Link> and
              tell us:
            </p>
            <ul className="ml-5 list-disc space-y-1">
              <li>your store name (the name buyers will see)</li>
              <li>a bit about you and what you make</li>
              <li>3 to 10 renders or photos of your work (PNG, JPG or WebP, up to 10MB each)</li>
              <li>optionally, your website, social profiles and where else you sell</li>
            </ul>
            <p>You also agree to the Seller Terms when you apply.</p>
          </Step>
          <Step n={3} title="We review your application">
            <p>
              We check your work and email you our decision with the reasons. If it&apos;s a yes, your account is
              turned into an artist account straight away. If it&apos;s a no, you can apply again.
            </p>
          </Step>
          <Step n={4} title="Set up your store">
            <p>
              Turn on two-factor authentication (needed before you can upload models, publish bundles or set up
              payouts), connect Stripe so you can be paid, then upload your first listing.
            </p>
          </Step>
        </ol>
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h3 className="text-sm font-semibold text-foreground">Got an invite code?</h3>
          <p className="mt-1">
            Artists normally apply, but if we&apos;ve sent you an invite code you can skip the application. Create
            an account, open the <Link to="/apply-artist" className={linkClass}>artist application</Link> page,
            and enter your code at the bottom with your store name. Codes are single use and can&apos;t be passed
            on.
          </p>
        </div>
      </Section>

      <Section title="The seller agreement in brief">
        <p>
          This is a short summary of our{' '}
          <Link to="/seller-terms" className={linkClass}>Seller Terms</Link>. The full terms are what you agree to,
          so please read them before you apply.
        </p>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong className="text-foreground">You keep your rights.</strong> You own your designs. You must have
            made them, or have the right to sell them, and your listing must show what the buyer gets.
          </li>
          <li>
            <strong className="text-foreground">You set the price.</strong> Prices are in pounds, before VAT. VAT is
            added on top for buyers and doesn&apos;t come out of your earnings. You choose a personal or commercial
            licence for each listing.
          </li>
          <li>
            <strong className="text-foreground">You keep 85%.</strong> We take 15% of the price after any discount,
            before VAT.
          </li>
          <li>
            <strong className="text-foreground">Card fee of 1.5%.</strong> This comes off your share to help cover
            payment costs. We pay the rest, including the fixed fee per order.
          </li>
          <li>
            <strong className="text-foreground">Example:</strong> on a £10.00 sale you earn £8.35.
          </li>
          <li>
            <strong className="text-foreground">Discounts.</strong> Promo codes you create come out of your share.
            Your own public sales are shared between us. Discounts {SITE_NAME} runs across the
            marketplace come out of our share only.
          </li>
          <li>
            <strong className="text-foreground">Getting paid.</strong> Payouts go through Stripe Connect, so you need
            to pass Stripe&apos;s checks. Each sale is held for 21 days to cover refunds, then paid on the 1st of
            each month once your balance is £10 or more. Smaller balances roll over.
          </li>
          <li>
            <strong className="text-foreground">Refunds.</strong> We decide refunds. If a buyer is refunded, it comes out
            of both shares: your 85% and our 15%. We cover the card fee.
          </li>
          <li>
            <strong className="text-foreground">Promoting your work.</strong> While your models are listed, we can
            use them in our promotion, such as renders, videos, planner tables, social posts, adverts and display
            prints. We always credit you and link your store where we can. {SITE_NAME} never gives your files or prints away
            unless you agree.
          </li>
          <li>
            <strong className="text-foreground">Removing listings.</strong> You can unpublish or delete a listing at
            any time. People who already bought it keep their download.
          </li>
          <li>
            <strong className="text-foreground">Changes and leaving.</strong> We email you at least 15 days before
            the terms change. You can close your seller account at any time and we pay what you&apos;re owed.
          </li>
        </ul>
      </Section>

      <Section title="Rules for sellers">
        <p>
          These come from the Seller Terms and our{' '}
          <Link to="/acceptable-use" className={linkClass}>Acceptable Use Policy</Link>, which has the full list.
        </p>
        <p className="font-medium text-foreground">What you can sell</p>
        <p>
          Digital 3D printable files for tabletop gaming and the hobby: terrain, scenery, buildings, vehicles,
          miniatures, bases and accessories. You can add supporting files such as PDF print guides. No physical
          goods or services.
        </p>
        <p className="font-medium text-foreground">What you can&apos;t sell</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>real weapons or working weapon parts (scale weapons on models are fine)</li>
          <li>copies of other artists&apos; or companies&apos; designs, or logos and characters you don&apos;t have permission to use</li>
          <li>sexually explicit content</li>
          <li>hateful or extremist content (historical wargaming models are fine)</li>
          <li>drug items, or anything made to commit crime or fraud</li>
          <li>listings whose images, scale or licence don&apos;t match the files</li>
        </ul>
        <p className="font-medium text-foreground">How you must behave</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>reply to buyer messages promptly and deal with problems fairly</li>
          <li>don&apos;t take buyers off the site to avoid our fee</li>
          <li>don&apos;t fake reviews, sales or stats</li>
          <li>don&apos;t share or resell files you bought from others</li>
          <li>don&apos;t try to get around our watermarking, copy checks or security</li>
        </ul>
        <p>
          If the rules are broken we may warn you, remove listings, hold payouts while we look into it, or suspend
          the account. We always email you our reasons and you can ask us to review the decision.
        </p>
      </Section>

      <Section title="How we protect your files">
        <p>
          Visitors only ever see a low-detail preview that can&apos;t be printed. Every download is watermarked to
          the buyer, and every upload is checked against the whole marketplace so nobody can re-list your work.{' '}
          <Link to="/creator-protection" className={linkClass}>Read how creator protection works</Link>.
        </p>
      </Section>

      <section className="mt-12 rounded-3xl bg-card p-8 text-center shadow-sm">
        <h2 className="text-xl font-semibold text-foreground">Ready to sell?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Questions first? <Link to="/contact" className={linkClass}>Get in touch</Link>.
        </p>
        <div className="mt-5 flex justify-center">{cta}</div>
      </section>
    </div>
  )
}

export default BecomeArtist
