import React from 'react'
import { Link } from 'react-router-dom'
import LegalLayout, { LegalSection } from './LegalLayout'

const PrivacyPolicy: React.FC = () => {
  return (
    <LegalLayout title="Privacy Policy" updated="5 October 2026" reviewed>
      <LegalSection heading="1. Who we are">
        <p>
          Artifact Armoury (“we”, “us”, “our”) is the trading name of{' '}
          <strong>Artifact Armoury Ltd</strong>, registered at Unit A, 82 James Carter
          Road, Mildenhall, IP28 7DE. We operate the Artifact Armoury marketplace and 3D
          table planner. This policy explains what personal data we collect from buyers and
          artists who use the site, why we collect it, who we share it with, and the rights
          you have over it. Artifact Armoury Ltd is the <strong>data controller</strong>{' '}
          for the personal data described here.
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
            <strong>Table planner data</strong> — the layouts you save (the pieces on your
            table, terrain settings and the name you give it), whether you have made a table
            shareable and its share link, and your planner preferences. Layouts you save are
            linked to your account; a table shared by link can be opened by anyone who has
            the link. We do not store files you have not uploaded as a seller.
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
          We use your browser’s local storage, and a small number of cookies, in these ways:
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Needed to provide what you asked for</strong> — your sign-in token, your
            cart, your chosen country (so prices include the right VAT), a note that you
            have seen a one-off notice, and your planner preferences. These stay on your
            device until you clear them or sign out, and need no consent.
          </li>
          <li>
            <strong>Usage analytics</strong> — a random session identifier kept in your
            browser’s session storage (it is removed when you close the tab) so we can group
            the pages and listings viewed in one visit. It is not shared with advertisers or
            third-party analytics companies, and artists only see aggregate counts. Because
            analytics is not strictly necessary, you can switch it off by blocking site
            storage in your browser, and the site will work as normal.
          </li>
          <li>
            <strong>Stripe at checkout</strong> — when you pay by card or PayPal, Stripe’s
            embedded payment form may set cookies or similar technology for fraud prevention
            and to complete the payment. These are needed to take your payment securely. We
            choose to use Stripe, so we are responsible for telling you; Stripe describes
            its own use in its{' '}
            <a
              href="https://stripe.com/cookies-policy/legal"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              cookies policy
            </a>
            .
          </li>
        </ul>
        <p>
          We do not run advertising or cross-site tracking cookies, and we do not sell or
          share your data with ad networks. You can clear cookies and site storage through
          your browser at any time; doing so may sign you out or empty your cart.
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

      <LegalSection heading="5. Why we use your data, and our lawful basis">
        <p>
          Under UK data-protection law we need a lawful basis for each use. These are the
          ones we rely on:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4 font-semibold">What we do</th>
                <th className="py-2 font-semibold">Lawful basis</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-b"><td className="py-2 pr-4">Create and run your account, sign you in</td><td className="py-2">Contract</td></tr>
              <tr className="border-b"><td className="py-2 pr-4">Take payment, deliver downloads, support and refunds</td><td className="py-2">Contract</td></tr>
              <tr className="border-b"><td className="py-2 pr-4">Keep tax, VAT and accounting records</td><td className="py-2">Legal obligation</td></tr>
              <tr className="border-b"><td className="py-2 pr-4">Messages between buyers and artists, and with support</td><td className="py-2">Contract, and legitimate interests in resolving disputes</td></tr>
              <tr className="border-b"><td className="py-2 pr-4">Security, fraud prevention and rate limits (IP address, request metadata)</td><td className="py-2">Legitimate interests in keeping the service secure</td></tr>
              <tr className="border-b"><td className="py-2 pr-4">Usage analytics and improving the service</td><td className="py-2">Legitimate interests in understanding and improving the service</td></tr>
              <tr className="border-b"><td className="py-2 pr-4">Anti-piracy watermarking and re-upload detection</td><td className="py-2">Legitimate interests (see below)</td></tr>
              <tr className="border-b"><td className="py-2 pr-4">Saving and sharing your table planner layouts</td><td className="py-2">Contract</td></tr>
              <tr className="border-b"><td className="py-2 pr-4">Reviewing artist applications</td><td className="py-2">Steps at your request before entering a contract</td></tr>
              <tr><td className="py-2 pr-4">Marketing emails about artists you follow</td><td className="py-2">Consent, which you can withdraw at any time</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          Where we rely on legitimate interests you can object to that processing (see
          “Your rights” below) and we will stop unless we have compelling grounds.
        </p>
      </LegalSection>

      <LegalSection heading="6. Anti-piracy watermarking (important)">
        <p>
          To protect artists against piracy, <strong>files we deliver are personalised with
          an invisible, encrypted watermark that encodes an identifier tied to your account
          and the specific order</strong>. Because we can link that identifier back to you,
          it is personal data in our hands. If a file is leaked or unlawfully shared, the
          watermark shows which download it came from; that starts an investigation and does
          not by itself prove who leaked it.
        </p>
        <p>
          The watermark is stored in a part of the file that is not used when printing. Our
          lawful basis is our <strong>legitimate interests</strong>, and those of our
          artists, in preventing intellectual-property theft. We have weighed that against
          your interests: the identifier reveals nothing to anyone who finds it without our
          key, and we only decode one when investigating a suspected leak or infringement.
          You can object to this processing at any time by contacting us. We keep watermark
          records for as long as the order exists and for up to six years afterwards, which
          matches the time limit for legal claims and covers our tax record-keeping.
        </p>
        <p>
          Separately, we compare the underlying geometry of newly uploaded files against
          our existing catalogue to detect re-uploads of stolen work. This check runs
          automatically at upload time and, where a match is found against another
          artist’s work, blocks the listing from going live; the affected artist can always
          contact us to query or appeal the outcome.
        </p>
      </LegalSection>

      <LegalSection heading="7. Payments and billing">
        <p>
          Payments are processed by <strong>Stripe</strong>, including card payments and
          PayPal (accepted through Stripe). We never see or store your full card number.
          Stripe acts as a processor for us when it takes your payment and calculates tax
          on our behalf, and as an independent controller for its own fraud prevention and
          legal compliance, which is why we also point you to{' '}
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
          anti-money-laundering law; we do not hold your bank details ourselves. We receive
          from Stripe only your verification status and payout records.
        </p>
      </LegalSection>

      <LegalSection heading="8. Who we share it with">
        <p>
          We share personal data only as needed to run the service:
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Stripe</strong> — to take payment, calculate tax, and pay artists (section 7).
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

      <LegalSection heading="9. International transfers">
        <p>
          Some of the providers in section 8 are based in, or process data in, the United
          States and other countries outside the UK. We only transfer personal data there
          where the UK GDPR allows it. <strong>Stripe, Cloudflare and Resend</strong> are
          certified under the UK Extension to the EU–US Data Privacy Framework (the “UK–US
          Data Bridge”), and their data-processing terms also include standard contractual
          clauses with the UK International Data Transfer Addendum as a fallback.{' '}
          <strong>Railway</strong> (our hosting and database provider) transfers under the
          standard contractual clauses and UK Addendum in its data-processing addendum.
          Email us at support@artifactarmoury.com if you would like a copy of the relevant
          safeguards.
        </p>
      </LegalSection>

      <LegalSection heading="10. Retention">
        <ul className="ml-5 list-disc space-y-1">
          <li><strong>Account data</strong> — while your account is open. If you close it we delete or anonymise it within 30 days, except the records below.</li>
          <li><strong>Orders, invoices and VAT records</strong> — 6 years from the end of the financial year of the sale, which tax law requires. This includes the order’s buyer identifier and consent record, and cannot be deleted on request while the law requires us to keep it.</li>
          <li><strong>Watermark records</strong> — as long as the order exists (6 years, as above) because a leak can be discovered long after a sale.</li>
          <li><strong>Messages</strong> — while both accounts exist, or until a dispute about them is resolved, then deleted with the account.</li>
          <li><strong>Contact-form messages and attachments</strong> — 2 years from your last message to us.</li>
          <li><strong>Security logs and rate-limit data</strong> — up to 90 days, longer only if tied to an investigation.</li>
          <li><strong>Usage analytics</strong> — event-level data for up to 13 months, then only aggregate counts with no link to you.</li>
          <li><strong>Saved table layouts</strong> — until you delete them or close your account.</li>
          <li><strong>Artist applications</strong> — kept for as long as your artist account exists if approved; if unsuccessful, 12 months from our decision (to answer follow-ups and recognise repeat applications), then deleted along with your portfolio images.</li>
        </ul>
        <p>
          <strong>Artists’ files after closure.</strong> When an artist deletes a listing or
          closes their account, the listing leaves the store, but buyers keep their downloads
          (see our Terms of Service for the exception for files we cannot lawfully supply),
          so we keep the files those buyers purchased and their per-buyer watermark records.
          We also keep each deleted file’s hash and shape fingerprint so the design stays
          protected against re-upload by someone else; neither identifies a person. The
          artist who uploaded a file is never blocked from uploading it again.
        </p>
      </LegalSection>

      <LegalSection heading="11. Security">
        <p>
          We use industry-standard measures to protect your data, including hashing of
          passwords, encryption of data in transit, and access controls on our systems. (The
          watermarking described in section 6 protects artists’ files, not your data.) No
          system is completely secure, and we cannot guarantee absolute security of
          information you transmit to us.
        </p>
      </LegalSection>

      <LegalSection heading="12. Your rights">
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

      <LegalSection heading="13. Children">
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

      <LegalSection heading="14. Changes to this policy">
        <p>
          We may update this policy from time to time. If we make a material change, we
          will update the “Last updated” date at the top of this page and, where appropriate, notify you
          through the site or by email.
        </p>
      </LegalSection>

      <LegalSection heading="15. Contact">
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
