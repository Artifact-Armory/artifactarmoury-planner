import React from 'react'
import Seo from '../../components/common/Seo'

/**
 * Shared shell for the legal pages (Terms, Privacy). Renders a title, a
 * last-updated line, a prominent "template — get it reviewed" banner, and the
 * body. The content of these pages is a starting template, NOT legal advice; it
 * must be reviewed by a qualified solicitor before the marketplace takes real
 * payments.
 */
const LegalLayout: React.FC<{
  title: string
  updated: string
  children: React.ReactNode
}> = ({ title, updated, children }) => (
  <div className="mx-auto max-w-3xl px-4 py-10">
    <Seo title={title} description={`${title} for Artifact Armoury, the marketplace and 3D planner for tabletop terrain.`} />
    <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
    <p className="mt-1 text-sm text-muted-foreground">Last updated: {updated}</p>

    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
      <strong>Template — not yet legal advice.</strong> This document is a starting point
      and must be reviewed by a qualified solicitor before launch, especially the
      sections on consumer rights, refunds and data protection.
    </div>

    <div className="mt-8 space-y-8 text-sm leading-relaxed text-muted-foreground">{children}</div>
  </div>
)

/** A titled section within a legal page. */
export const LegalSection: React.FC<{ heading: string; children: React.ReactNode }> = ({
  heading,
  children,
}) => (
  <section>
    <h2 className="text-base font-semibold text-foreground">{heading}</h2>
    <div className="mt-2 space-y-3">{children}</div>
  </section>
)

export default LegalLayout
