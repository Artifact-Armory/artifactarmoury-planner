import React from 'react'
import { Link } from 'react-router-dom'
import LegalLayout, { LegalSection } from './LegalLayout'

const PrivacyPolicy: React.FC = () => {
  return (
    <LegalLayout title="Privacy Policy" updated="5 October 2026" reviewed>
      <LegalSection heading="1. Who we are">
        <p>
          Artifact Armoury (“we”, “us”, “our”) operates the Artifact Armoury marketplace
          and 3D table planner. This policy explains what personal data we collect from
          buyers and artists who use the site, why we collect it, who we share it with,
          and the rights you have over it. We are the <strong>data controller</strong> for
          the personal data described here.
        </p>
        <p>
          Questions, requests, or complaints about this policy or your data should go to{' '}
          <a href="mailto:support@artifactarmoury.com" className="text-primary underline">
            support@artifactarmoury.com
          </a>
          . That is also the address for any general query — we do not run a separate
          privacy mailbox.
        </p>
      </LegalSection>

      <LegalSection heading="2. Information we collect">
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Account data</strong> — your email address, display name, password
            (stored hashed, never in plain text), account role (buyer/artist), and email
            verification status, and your marketing-email preference (and when you gave
            consent).
          </li>
          <li>
            <strong>Order and billing data</strong> — the models or bundles you buy, order
            references, the billing address and country you give us at checkout (used to
            calculate VAT and required by our payment provider), and, for artists, payout
            details held by our payment processor.
          </li>
          <li>
            <strong>Content you upload</strong> — for artists, the model files, images,
            names, descriptions, prices and licence terms you list.
          </li>
          <li>
            <strong>Artist application data</strong> — if you apply to sell on Artifact
            Armoury, we collect what you put in the application: your store name, a
            description of yourself and your work, any website and social media links you
            choose to give, details of where else you sell, and the portfolio images you
            upload. We also keep our decision on your application and the reason we gave
            you.
          </li>
          <li>
            <strong>Messages</strong> — if you message an artist or buyer through the site,
            or contact our support team (including any files you attach), we store that
            message and its metadata (sender, recipient, timestamp) to deliver it and to
            handle any dispute.
          </li>
          <li>
            <strong>Usage data</strong> — pages viewed, searches, and interactions with the
            marketplace and planner. This is used to run and improve the service and to
            give artists aggregate, non-identifying analytics about their own listings
            (e.g. view and sale counts) — never your individual identity.
          </li>
          <li>
            <strong>Technical data</strong> — IP address and basic request metadata,
            collected automatically for security, fraud prevention, and to enforce fair-use
            limits on uploads, contact form submissions, and similar actions.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. Cookies and local storage">
        <p>
          We use a small number of <strong>strictly necessary</strong> cookies and
          browser-storage entries to keep you signed in, remember your cart, your chosen
          country (for VAT), and similar preferences on your own device. We do not run
          third-party advertising or tracking cookies, and we do not sell or share your
          data with ad networks. If you pay by card or PayPal, Stripe (see below) may set
          its own cookies during checkout as part of its fraud-prevention systems — this is
          governed by Stripe’s own privacy policy, not ours. You can control or clear
          cookies and site storage through your browser at any time; doing so may sign you
          out or reset your cart.
        </p>
      </LegalSection>

      <LegalSection heading="4. How we use your information">
        <p>
          We use your data to provide the marketplace and planner, process orders and
          downloads, calculate and charge the correct tax, prevent fraud and piracy,
          moderate uploads and disputes, provide customer support, send service
          communications (order confirmations, download links, security notices) and,
          where you have opted in, marketing emails (see below), and to meet our legal and
          tax obligations. You can opt out of marketing emails at any time via the
          unsubscribe link in the email or your account settings — this does not affect
          service emails, which we send regardless.
        </p>
        <p>
          <strong>Emails about artists you follow.</strong> If you tick the optional
          “email me when artists I follow release new models or start sales” box when you
          create your account, or later switch on “Artists I follow” under email
          notifications in your account settings, we will email you when an artist you
          follow <strong>releases a new model</strong> or <strong>starts a sale</strong>.
          This is optional and is never pre-ticked, and we do not send these emails to
          anyone who has not opted in. Our lawful basis is your <strong>consent</strong>,
          which we record (including when you gave it). You can withdraw it at any time
          using the unsubscribe link in any of these emails or the setting in your account
          settings; withdrawing does not affect anything we sent before. To avoid flooding
          your inbox, we send at most one such email per artist every few hours, even if
          they publish several models at once. Separately, you will always see these
          updates as in-site notifications while signed in — those are not emails and are
          not affected by this setting.
        </p>
        <p>
          <strong>Artist applications.</strong> We use application data to review your
          application, to decide whether to invite you to sell, to email you our decision
          and reasoning, and to send an invite code if you are approved. Our lawful basis
          is taking steps at your request before entering a contract with you. Our team
          reviews applications by hand. We do not use automated decision-making to accept
          or reject them.
        </p>
      </LegalSection>

      <LegalSection heading="5. Download watermarking (important)">
        <p>
          To protect artists against piracy, <strong>every model file you download is
          personalised with an invisible, encrypted watermark that encodes an identifier
          tied to your account and the specific order</strong>. This lets a leaked or
          unlawfully shared file be traced back to the account that downloaded it.
        </p>
        <p>
          The watermark is embedded in a part of the file that does not change the printed
          object. We process this data on the basis of our <strong>legitimate interests</strong>{' '}
          (and those of our artists) in preventing intellectual-property theft, and to
          perform our contract with you. We only decode a watermark when investigating a
          suspected leak or infringement, and we retain the information for as long as
          needed for that purpose.
        </p>
        <p>
          Separately, we compare the underlying geometry of newly uploaded files against
          our existing catalogue to detect re-uploads of stolen work. This check runs
          automatically at upload time and, where a match is found against another
          artist’s work, blocks the listing from going live; the affected artist can always
          contact us to query or appeal the outcome.
        </p>
      </LegalSection>

      <LegalSection heading="6. Payments and billing">
        <p>
          Payments are processed by <strong>Stripe</strong>, including card payments and
          PayPal (accepted through Stripe). We never see or store your full card number.
          Stripe uses your billing address and country to calculate tax and to run its own
          fraud checks, and acts as an independent data controller for that processing —
          see{' '}
          <a
            href="https://stripe.com/privacy"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            Stripe’s privacy policy
          </a>
          . Artists are paid out via Stripe Connect, which separately collects the
          identity and bank details Stripe needs to verify a payout account and meet
          anti-money-laundering law; we do not hold your bank details ourselves.
        </p>
      </LegalSection>

      <LegalSection heading="7. Who we share it with">
        <p>
          We share personal data only as needed to run the service:
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Stripe</strong> — to take payment, calculate tax, and pay artists (§6).
          </li>
          <li>
            <strong>Resend</strong> — our email provider, to send order confirmations,
            account and support emails and, where you have opted in, emails about artists
            you follow.
          </li>
          <li>
            <strong>Railway and Cloudflare</strong> — our hosting, database and file-storage
            providers, who host the infrastructure the marketplace runs on and the files
            you upload or purchase.
          </li>
          <li>
            <strong>The other party to a transaction</strong> — an artist can see the
            display name of a buyer who messages them about their model; a buyer can see an
            artist’s public storefront details. We do not reveal a buyer’s email, address or
            payment details to an artist, or vice versa.
          </li>
        </ul>
        <p>
          Application details and portfolio images are visible only to our administrators,
          and are stored with the same hosting and file-storage providers listed above. We
          do not share them with other artists or buyers.
        </p>
        <p>
          Artists otherwise receive only aggregate, non-identifying analytics about their
          own listings — never an individual buyer’s identity. We do not sell your personal
          data, and we only disclose it beyond the above where required by law, to enforce
          our terms, or to protect the rights, property or safety of Artifact Armoury, our
          users, or others.
        </p>
      </LegalSection>

      <LegalSection heading="8. International transfers">
        <p>
          Our hosting and payment providers may process data on servers outside the UK and
          EEA. Where they do, we rely on the safeguards those providers offer for
          international transfers (such as the EU Standard Contractual Clauses or the UK
          International Data Transfer Addendum). Contact us if you would like more detail
          on the safeguards that apply to a particular provider.
        </p>
      </LegalSection>

      <LegalSection heading="9. Retention">
        <p>
          We keep account and order data for as long as your account is active and, after
          that, for as long as required for tax, accounting and legal purposes. Messages
          are kept for as long as the account they belong to exists, or as needed to resolve
          a dispute. Watermark-tracing data is kept for as long as needed to protect against
          and investigate infringement. When an artist deletes a model listing, it is
          removed from the store but we keep its file hash and shape fingerprint, so the
          design stays protected against re-upload by someone else. The artist who
          uploaded it is never blocked from uploading their own file again.
        </p>
        <p>
          If your artist application is approved, we keep it for as long as your artist
          account exists. If it is unsuccessful, we keep it for a limited period after our
          decision so we can respond to any follow-up and recognise repeat applications,
          then delete it, including the images you uploaded.
        </p>
      </LegalSection>

      <LegalSection heading="10. Security">
        <p>
          We use industry-standard measures to protect your data, including encryption of
          passwords and payment data in transit, access controls on our systems, and the
          per-download watermarking described in §5 to trace leaked files. No system is
          completely secure, and we cannot guarantee absolute security of information you
          transmit to us.
        </p>
      </LegalSection>

      <LegalSection heading="11. Your rights">
        <p>
          Subject to law, you can request access to, correction or deletion of your personal
          data, object to or restrict certain processing, and request a copy of your data in
          a portable format. To exercise any of these rights, email{' '}
          <a href="mailto:support@artifactarmoury.com" className="text-primary underline">
            support@artifactarmoury.com
          </a>
          . We will normally respond within one month. You also have the right to complain
          to your local data-protection authority — in the UK, the{' '}
          <a
            href="https://ico.org.uk"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            Information Commissioner’s Office (ICO)
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="12. Children">
        <p>
          Artifact Armoury is not directed at children, and we do not knowingly collect
          personal data from anyone under 16. If you believe a child has given us personal
          data, contact us at{' '}
          <a href="mailto:support@artifactarmoury.com" className="text-primary underline">
            support@artifactarmoury.com
          </a>{' '}
          and we will delete it.
        </p>
      </LegalSection>

      <LegalSection heading="13. Changes to this policy">
        <p>
          We may update this policy from time to time. If we make a material change, we
          will update the “Last updated” date above and, where appropriate, notify you
          through the site or by email.
        </p>
      </LegalSection>

      <LegalSection heading="14. Contact">
        <p>
          If you have any questions or queries about this policy or how we handle your
          data, please contact us at{' '}
          <a href="mailto:support@artifactarmoury.com" className="text-primary underline">
            support@artifactarmoury.com
          </a>
          . See also our{' '}
          <Link to="/terms-of-service" className="text-primary underline">Terms of Service</Link>.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}

export default PrivacyPolicy
