import React from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { browseApi } from '../api/endpoints/browse'
import ModelGrid from '../components/models/ModelGrid'
import Spinner from '../components/ui/Spinner'
import Seo from '../components/common/Seo'
import NotFound from './NotFound'
import { TOPICS, topicBySlug, topicPath } from '../seo/topics'

/**
 * Topic landing page (/stl/<slug>): a fixed catalogue filter with its own URL,
 * title, heading and intro, so search engines have a page to rank for searches
 * like "WW2 tank STL". Topics are defined in seo/topics.ts.
 */
const Topic: React.FC = () => {
  const { slug } = useParams()
  const topic = topicBySlug(slug)

  const { data, isLoading } = useQuery({
    queryKey: ['topic-models', topic?.slug],
    queryFn: () => browseApi.searchModels({ terms: topic!.terms, sortBy: 'popular', limit: 48 }),
    enabled: Boolean(topic),
  })

  if (!topic) return <NotFound />

  const total = data?.pagination.totalItems ?? 0
  const browseLink = `/browse?terms=${encodeURIComponent(topic.terms)}`

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <Seo title={topic.title} description={topic.description} path={topicPath(topic)} />
      <nav className="text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-foreground">Home</Link>
        <span className="mx-2">/</span>
        <Link to="/browse" className="hover:text-foreground">Browse</Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{topic.label}</span>
      </nav>
      <h1 className="mt-4 text-3xl font-bold text-foreground">{topic.h1}</h1>
      <p className="mt-3 max-w-3xl text-muted-foreground">{topic.intro}</p>

      <div className="mt-8">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner size="lg" />
          </div>
        ) : (
          <ModelGrid models={data?.models ?? []} emptyMessage="No models here yet. Check back soon." />
        )}
      </div>

      {total > (data?.models.length ?? 0) && (
        <div className="mt-8 text-center">
          <Link to={browseLink} className="text-sm font-medium text-primary hover:text-primary/80">
            See all {total} models, with filters for scale, era and printer type
          </Link>
        </div>
      )}

      <section className="mt-14 border-t border-border pt-8">
        <h2 className="text-lg font-semibold text-foreground">More to explore</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {TOPICS.filter((t) => t.slug !== topic.slug).map((t) => (
            <Link
              key={t.slug}
              to={topicPath(t)}
              className="rounded-full border border-border bg-muted px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {t.label}
            </Link>
          ))}
        </div>
        <p className="mt-6 max-w-3xl text-sm text-muted-foreground">
          All models on Artifact Armoury are digital STL files for 3D printing, sold by the artists who made them. Pay
          once, download straight away and print as many copies as you like for your own table. You can try most models
          on a 3D table in the <Link to="/planner" className="text-primary hover:text-primary/80">free planner</Link>{' '}
          before you buy.
        </p>
      </section>
    </div>
  )
}

export default Topic
