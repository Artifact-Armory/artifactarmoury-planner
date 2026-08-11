import React from 'react'
import { Link } from 'react-router-dom'
import LegalLayout, { LegalSection } from './LegalLayout'

const PrivacyPolicy: React.FC = () => {
  return (
    <LegalLayout title="Privacy Policy" updated="12 July 2026">
      <LegalSection heading="1. Introduction">
        <p>
          This policy explains what personal data Artifact Armoury collects, why, and what
          rights you have. We are the data controller for the personal data described here.
        </p>
      </LegalSection>

      <LegalSection heading="2. What we collect">
        <ul className="ml-5 list-disc space-y-1">
          <li><strong>Account data</strong> — your email address, display name, password (stored hashed) and, for artists, payout details held by our payment processor.</li>
          <li><strong>Order data</strong> — the models you buy, order references and, for print-and-ship orders, a delivery address.</li>
          <li><strong>Usage data</strong> — pages viewed, searches and interactions, used to run and improve the marketplace and give artists aggregate analytics.</li>
          <li><strong>Content you upload</strong> — for artists, the model files, images and descriptions you list.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. Download watermarking (important)">
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
          suspected leak or infringement, and we retain the information for as long as needed
          for that purpose.
        </p>
      </LegalSection>

      <LegalSection heading="4. How we use your data">
        <p>
          We use your data to provide the marketplace and planner, process orders and
          downloads, prevent fraud and piracy, provide customer support, send service and
          (where you have opted in) marketing emails, and meet our legal obligations.
        </p>
      </LegalSection>

      <LegalSection heading="5. Who we share it with">
        <p>
          We share data only as needed to run the service: our payment processor (to take
          payment and pay artists), our hosting and file-storage providers, and our email
          provider. Artists receive aggregate, non-identifying analytics about their own
          listings — not your identity. We do not sell your personal data.
        </p>
      </LegalSection>

      <LegalSection heading="6. Retention">
        <p>
          We keep account and order data for as long as your account is active and as
          required for tax, accounting and legal purposes. Watermark-tracing data is kept
          for as long as needed to protect against and investigate infringement.
        </p>
      </LegalSection>

      <LegalSection heading="7. Your rights">
        <p>
          Subject to law, you can request access to, correction or deletion of your personal
          data, object to or restrict certain processing, and request a copy of your data.
          To exercise any right, contact us at{' '}
          <a href="mailto:privacy@artifactarmoury.com" className="text-primary underline">
            privacy@artifactarmoury.com
          </a>
          . You also have the right to complain to your local data-protection authority (in
          the UK, the ICO).
        </p>
      </LegalSection>

      <LegalSection heading="8. Cookies">
        <p>
          We use essential cookies to keep you signed in and to run the site, and may use
          analytics cookies to understand usage. You can control cookies through your browser.
        </p>
      </LegalSection>

      <LegalSection heading="9. Contact">
        <p>
          Questions about this policy or your data? Email{' '}
          <a href="mailto:privacy@artifactarmoury.com" className="text-primary underline">
            privacy@artifactarmoury.com
          </a>
          . See also our{' '}
          <Link to="/terms-of-service" className="text-primary underline">Terms of Service</Link>.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}

export default PrivacyPolicy
