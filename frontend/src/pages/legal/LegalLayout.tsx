import React from 'react'

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
    <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
    <p className="mt-1 text-sm text-gray-500">Last updated: {updated}</p>

    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      <strong>Template — not yet legal advice.</strong> This document is a starting point
      and must be reviewed by a qualified solicitor before launch, especially the
      sections on consumer rights, refunds and data protection.
    </div>

    <div className="mt-8 space-y-8 text-sm leading-relaxed text-gray-700">{children}</div>
  </div>
)

/** A titled section within a legal page. */
export const LegalSection: React.FC<{ heading: string; children: React.ReactNode }> = ({
  heading,
  children,
}) => (
  <section>
    <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
    <div className="mt-2 space-y-3">{children}</div>
  </section>
)

export default LegalLayout
