import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import RedeemArtistInvite from './RedeemArtistInvite'
import ArtistApplicationForm from './ArtistApplicationForm'
import Seo from '../../components/common/Seo'
import Spinner from '../../components/ui/Spinner'
import { SITE_NAME } from '../../config/brand'
import { useAuthStore } from '../../store/authStore'
import { artistApplicationsApi } from '../../api/endpoints/artistApplications'

const ArtistApplication: React.FC = () => {
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const isArtist = user?.role === 'artist'

  const { data: application, isLoading } = useQuery({
    queryKey: ['my-artist-application'],
    queryFn: artistApplicationsApi.mine,
    enabled: !isArtist,
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['my-artist-application'] })

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* Behind ProtectedRoute (sign-in required), so a crawler can never actually
          reach this content, so noindex rather than let it index a login wall. */}
      <Seo title="Become an Artist" noindex />
      <section className="rounded-3xl bg-card p-8 shadow-sm">
        <h1 className="text-3xl font-semibold text-foreground">Become an {SITE_NAME} artist</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          We&apos;re building a curated marketplace of model makers. Submit your portfolio and we&apos;ll send an invite code
          if there&apos;s a good fit. Artists keep 85% of every sale and gain access to advanced analytics and customer
          messaging.
        </p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-primary/20 bg-primary/10 p-5">
            <h2 className="text-sm font-semibold text-primary">What we look for</h2>
            <ul className="mt-3 space-y-2 text-sm text-primary/80">
              <li>• Original or licensed 3D terrain with consistent quality</li>
              <li>• High-resolution renders or photos</li>
              <li>• Layered STL or resin-friendly meshes</li>
              <li>• Ability to respond to customer messages</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-border bg-muted p-5">
            <h2 className="text-sm font-semibold text-foreground">How it works</h2>
            <ol className="mt-3 space-y-2 text-sm text-foreground">
              <li>1. Fill in the form below and add your portfolio images</li>
              <li>2. Our team reviews your application</li>
              <li>3. We email you our decision and the reasoning. If it&apos;s a yes, your invite code is in the email</li>
            </ol>
          </div>
        </div>

        {!isArtist && (
          <>
            {isLoading ? (
              <div className="flex justify-center py-12"><Spinner size="lg" /></div>
            ) : application?.status === 'pending' ? (
              <div className="mt-8 rounded-2xl border border-primary/30 bg-primary/5 p-6">
                <div className="flex items-center gap-2">
                  <Clock size={18} className="text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">Your application is under review</h2>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Thanks for applying as <span className="font-medium text-foreground">{application.artistName}</span>.
                  We&apos;ll email you at {user?.email} once we&apos;ve made a decision.
                </p>
              </div>
            ) : (
              <>
                {application?.status === 'approved' && (
                  <div className="mt-8 rounded-2xl border border-green-200 bg-green-50 p-6">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={18} className="text-green-700" />
                      <h2 className="text-sm font-semibold text-green-900">Your application was approved</h2>
                    </div>
                    <p className="mt-2 text-sm text-green-900/80">
                      {application.inviteCode
                        ? 'Your invite code is filled in below. Choose your store name and accept the seller terms to start selling.'
                        : 'Check your email for your invite code and enter it below.'}
                    </p>
                  </div>
                )}

                {application?.status === 'rejected' && (
                  <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-6">
                    <div className="flex items-center gap-2">
                      <XCircle size={18} className="text-red-700" />
                      <h2 className="text-sm font-semibold text-red-900">Your last application wasn&apos;t successful</h2>
                    </div>
                    {application.decisionReason && (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-red-900/80">{application.decisionReason}</p>
                    )}
                    <p className="mt-2 text-sm text-red-900/80">You&apos;re welcome to apply again below.</p>
                  </div>
                )}

                {application?.status !== 'approved' && (
                  <ArtistApplicationForm defaultName={user?.name ?? ''} onSubmitted={refresh} />
                )}
              </>
            )}
          </>
        )}

        <div className="mt-6 rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">
            How we look after your files
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Visitors browsing the site never receive your real model. They see a low-detail
            stand-in that can&apos;t be printed. Each buyer&apos;s download is prepared
            individually, so if a file ever turns up where it shouldn&apos;t, we can tell you
            which sale it came from. And every new upload is checked against the whole
            marketplace, so nobody can re-list your work as their own.
          </p>
          <Link
            to="/creator-protection"
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
          >
            The full detail, including what we don&apos;t claim →
          </Link>
        </div>

        {application?.status !== 'pending' && (
          <RedeemArtistInvite
            key={application?.inviteCode ?? 'manual'}
            initialCode={application?.inviteCode ?? ''}
            initialArtistName={application?.status === 'approved' ? application.artistName : ''}
          />
        )}
      </section>
    </div>
  )
}

export default ArtistApplication
