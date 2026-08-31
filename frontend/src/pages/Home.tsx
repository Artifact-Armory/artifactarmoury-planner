import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Compass, RefreshCcw, ShieldCheck } from 'lucide-react'
import Spinner from '../components/ui/Spinner'
import ModelGrid from '../components/models/ModelGrid'
import SaleCarousel from '../components/models/SaleCarousel'
import Logo from '../components/common/Logo'
import Seo from '../components/common/Seo'
import { browseApi } from '../api/endpoints/browse'
import { SITE_NAME, SITE_TAGLINE } from '../config/brand'

const HOME_DESCRIPTION =
  'Artifact Armoury is a marketplace and free 3D planner for tabletop terrain. Browse print-ready STL scenery from independent artists, lay out your wargaming table before you print, and buy each model once — print it as many times as your table needs.'

const FEATURES = [
  {
    icon: Compass,
    title: 'Plan your table in 3D',
    body: 'Drag STL terrain onto a virtual board and lay out your whole battlefield before you print a single piece — no account required.',
  },
  {
    icon: RefreshCcw,
    title: 'Buy the STL once, print it forever',
    body: 'One purchase per model, no per-print fee. Print one copy or twenty for a full table of scenery.',
  },
  {
    icon: ShieldCheck,
    title: 'Every upload is mesh-checked',
    body: 'We run each STL through automated watertight and manifold checks before it lists, so what you download prints cleanly — not a broken mesh.',
  },
] as const

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
      <Seo title={SITE_NAME} description={HOME_DESCRIPTION} path="/" />
      <section className="relative isolate overflow-hidden rounded-3xl border border-border px-6 py-20 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_48px_-24px_rgba(15,23,42,0.12)] sm:px-12 sm:py-28">
        <video
          className="absolute inset-0 -z-10 h-full w-full object-cover"
          src="/videos/hero-loop.mp4"
          poster="/videos/hero-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/80 via-black/40 to-black/10" />
        <div className="max-w-3xl">
          {/* The hero's overlay gradient is lightest at the top, so the lockup gets
              its own shadow to stay legible over whatever frame the video is on. */}
          <Logo
            variant="lockup"
            title={SITE_NAME}
            className="h-16 w-auto text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)] sm:h-20"
          />
          <h1 className="mt-4 text-3xl font-bold text-white sm:text-4xl">Print-ready terrain, built for the table.</h1>
          <p className="mt-4 text-white/80">
            {SITE_TAGLINE} Browse artist-made 3D models, drag them onto a virtual table to plan your board, and buy
            each STL once — print it as many times as your table needs.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/planner"
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-[background-color,transform] duration-150 ease-[var(--ease-out)] hover:bg-primary/90 motion-safe:active:scale-[0.98]"
            >
              Open the table builder
            </Link>
            <Link
              to="/browse"
              className="inline-flex items-center justify-center rounded-md border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors duration-150 ease-[var(--ease-out)] hover:bg-white/20"
            >
              Browse the marketplace
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-10 grid gap-5 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_1px_rgba(15,23,42,0.03)] transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-out)] motion-safe:hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_20px_40px_-16px_rgba(37,99,235,0.18)]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors duration-200 ease-[var(--ease-out)] group-hover:bg-primary/15">
              <f.icon size={18} />
            </span>
            <h3 className="text-base font-semibold text-foreground">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.body}</p>
          </div>
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
                className="rounded-full border border-border bg-muted px-4 py-2 text-sm text-muted-foreground transition-colors duration-150 ease-[var(--ease-out)] hover:bg-accent hover:text-accent-foreground"
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
