import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import Spinner from '../components/ui/Spinner'
import ModelGrid from '../components/models/ModelGrid'
import { browseApi } from '../api/endpoints/browse'
import { MODEL_SHOWCASE_ENABLED } from '../config/features'

const Home: React.FC = () => {
  const { data: featuredModels, isLoading: loadingFeatured } = useQuery(
    ['featured-models'],
    () => browseApi.getFeaturedModels(8),
    { enabled: MODEL_SHOWCASE_ENABLED },
  )

  const { data: trendingModels, isLoading: loadingTrending } = useQuery(
    ['trending-models'],
    () => browseApi.getTrendingModels(8),
    { enabled: MODEL_SHOWCASE_ENABLED },
  )

  const { data: newArrivals, isLoading: loadingNew } = useQuery(
    ['new-models'],
    () => browseApi.getNewArrivals(8),
    { enabled: MODEL_SHOWCASE_ENABLED },
  )

  const { data: categories } = useQuery(['browse-categories'], () => browseApi.getCategories())

  const hasFeatured = MODEL_SHOWCASE_ENABLED && (featuredModels?.length ?? 0) > 0
  const hasTrending = MODEL_SHOWCASE_ENABLED && (trendingModels?.length ?? 0) > 0
  const hasNewArrivals = MODEL_SHOWCASE_ENABLED && (newArrivals?.length ?? 0) > 0
  const hasAnyModels = hasFeatured || hasTrending || hasNewArrivals
  const showcaseLoading = MODEL_SHOWCASE_ENABLED && (loadingFeatured || loadingTrending || loadingNew)
  const showEmptyState = !MODEL_SHOWCASE_ENABLED || (!showcaseLoading && !hasAnyModels)

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-500 to-purple-500 px-6 py-16 text-white shadow-lg sm:px-12">
        <div className="max-w-3xl">
          <p className="text-sm uppercase tracking-widest text-indigo-200">Artifact Armoury</p>
          <h1 className="mt-4 text-3xl font-bold sm:text-4xl">Build immersive tabletop worlds with premium terrain</h1>
          <p className="mt-4 text-indigo-100">
            Discover artisan-crafted 3D models for your next campaign, customize layouts, and print with professional
            settings. Join a growing community of artists and hobbyists.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/browse"
              className="inline-flex items-center justify-center rounded-md bg-white px-6 py-3 text-sm font-semibold text-indigo-600 shadow hover:bg-indigo-50"
            >
              Browse marketplace
            </Link>
            <Link
              to="/about"
              className="inline-flex items-center justify-center rounded-md border border-white/70 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10"
            >
              Learn more
            </Link>
          </div>
        </div>
      </section>

      {categories?.length ? (
        <section className="mt-12">
          <h2 className="text-lg font-semibold text-gray-900">Popular categories</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            {categories.slice(0, 8).map((category) => (
              <Link
                key={category.category}
                to={`/browse?category=${encodeURIComponent(category.category ?? '')}`}
                className="rounded-full border border-indigo-100 bg-indigo-50 px-4 py-2 text-sm text-indigo-700 hover:bg-indigo-100"
              >
                {category.category} · {category.modelCount}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {showcaseLoading && !hasAnyModels ? (
        <section className="mt-12">
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        </section>
      ) : null}

      {showEmptyState ? (
        <section className="mt-12">
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center shadow-sm">
            <h2 className="text-2xl font-semibold text-gray-900">No marketplace models yet</h2>
            <p className="mt-3 text-sm text-gray-500 max-w-2xl mx-auto">
              Check back soon—artists will be able to publish new terrain here once their uploads are approved.
            </p>
          </div>
        </section>
      ) : null}

      {hasFeatured ? (
        <section className="mt-12">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-gray-900">Featured terrain</h2>
            <Link to="/browse" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
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
      ) : null}

      {hasTrending ? (
        <section className="mt-16">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-gray-900">Trending this week</h2>
            <Link to="/browse?sortBy=popular" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
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
      ) : null}

      {hasNewArrivals ? (
        <section className="mt-16">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-gray-900">New arrivals</h2>
            <Link to="/browse?sortBy=recent" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
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
      ) : null}
    </div>
  )
}

export default Home
