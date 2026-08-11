import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import Spinner from '../components/ui/Spinner'
import ModelGrid from '../components/models/ModelGrid'
import SaleCarousel from '../components/models/SaleCarousel'
import { browseApi } from '../api/endpoints/browse'
import { Card, CardContent } from '../components/shadcn/card'
import { SITE_NAME, SITE_TAGLINE } from '../config/brand'

const Home: React.FC = () => {
  const { data: featuredModels, isLoading: loadingFeatured } = useQuery({
    queryKey: ['featured-models'],
    queryFn: () => browseApi.getFeaturedModels(8),
  })

  const { data: trendingModels, isLoading: loadingTrending } = useQuery({
    queryKey: ['trending-models'],
    queryFn: () => browseApi.getTrendingModels(8),
  })

  const { data: newArrivals, isLoading: loadingNew } = useQuery({
    queryKey: ['new-models'],
    queryFn: () => browseApi.getNewArrivals(8),
  })

  const { data: categories } = useQuery({
    queryKey: ['browse-categories'],
    queryFn: () => browseApi.getCategories(),
  })

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      {/* Hero stays deliberately dark/dramatic (forge motif) regardless of the site's
          light/dark toggle — it's a decorative banner, not body content. */}
      <section className="overflow-hidden rounded-3xl border border-border bg-linear-to-br from-neutral-950 via-stone-900 to-amber-950 px-6 py-16 text-white shadow-lg sm:px-12">
        <div className="max-w-3xl">
          <p className="text-sm uppercase tracking-widest text-amber-400">{SITE_NAME}</p>
          <h1 className="mt-4 text-3xl font-bold sm:text-4xl">Build immersive tabletop worlds with premium terrain</h1>
          <p className="mt-4 text-stone-300">
            {SITE_TAGLINE} Discover artisan-crafted 3D models for your next campaign, customize layouts, and
            print with professional settings. Join a growing community of artists and hobbyists.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/browse"
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              Browse marketplace
            </Link>
            <Link
              to="/planner"
              className="inline-flex items-center justify-center rounded-md border border-white/20 bg-white/10 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-white/20"
            >
              Try the Table Builder
            </Link>
            <Link
              to="/about"
              className="inline-flex items-center justify-center rounded-md border border-white/30 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10"
            >
              Learn more
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-10 grid gap-5 sm:grid-cols-3">
        {[
          {
            title: 'Design in 3D',
            body: 'Drag artist-made terrain onto a virtual table, stack it and lay out your whole board — no account needed to start.',
          },
          {
            title: 'Buy once, print forever',
            body: 'Purchase an STL a single time and print as many copies as you like. No per-print fees, ever.',
          },
          {
            title: 'Made by real artists',
            body: 'Every model is uploaded by an independent creator, watermarked to protect their work, and ready to print.',
          },
        ].map((f) => (
          <Card key={f.title}>
            <CardContent>
              <h3 className="text-base font-semibold text-foreground">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      {categories?.length ? (
        <section className="mt-12">
          <h2 className="text-lg font-semibold text-foreground">Popular categories</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            {categories.slice(0, 8).map((category) => (
              <Link
                key={category.category}
                to={`/browse?category=${encodeURIComponent(category.category ?? '')}`}
                className="rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm text-primary hover:bg-primary/20"
              >
                {category.category} · {category.modelCount}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <SaleCarousel />

      <section className="mt-12">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-foreground">Featured terrain</h2>
          <Link to="/browse" className="text-sm font-medium text-primary hover:text-primary/80">
            View all
          </Link>
        </div>
        <div className="mt-6">
          {loadingFeatured ? (
            <div className="flex justify-center py-10">
              <Spinner size="lg" />
            </div>
          ) : (
            <ModelGrid models={featuredModels ?? []} emptyMessage="No featured models available right now." />
          )}
        </div>
      </section>

      <section className="mt-16">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-foreground">Trending this week</h2>
          <Link to="/browse?sortBy=popular" className="text-sm font-medium text-primary hover:text-primary/80">
            Explore trending
          </Link>
        </div>
        <div className="mt-6">
          {loadingTrending ? (
            <div className="flex justify-center py-10">
              <Spinner size="lg" />
            </div>
          ) : (
            <ModelGrid models={trendingModels ?? []} emptyMessage="No trending models found." />
          )}
        </div>
      </section>

      <section className="mt-16">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-foreground">New arrivals</h2>
          <Link to="/browse?sortBy=recent" className="text-sm font-medium text-primary hover:text-primary/80">
            See what's new
          </Link>
        </div>
        <div className="mt-6">
          {loadingNew ? (
            <div className="flex justify-center py-10">
              <Spinner size="lg" />
            </div>
          ) : (
            <ModelGrid models={newArrivals ?? []} emptyMessage="No new models published yet." />
          )}
        </div>
      </section>
    </div>
  )
}

export default Home
