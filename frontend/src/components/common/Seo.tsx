import { useEffect } from 'react'
import { SITE_NAME, SITE_DOMAIN } from '../../config/brand'

/**
 * Per-page <title>/meta description/canonical/OG tags.
 *
 * Before this component, EVERY route shared the single static <title> and
 * <meta name="description"> baked into index.html — Home, Browse, a product
 * page, About all looked identical to a search engine. Drop one <Seo> near
 * the top of a page's returned JSX (in every early-return branch, since only
 * what actually rendered takes effect) to give it its own title/description/
 * canonical.
 *
 * Plain useEffect + direct DOM writes, not react-helmet-async: tried it
 * first, but Vite's dependency pre-bundling gives this app's own React tree
 * and the library's optimized chunk two separately CJS-wrapped copies of
 * `react` (confirmed: two different chunk-*.js files each defining their own
 * `require_react`), so the Context.Provider it renders and the
 * Context.Consumer its Dispatcher reads from don't resolve to the same
 * Context object — nothing throws, it just silently never commits to
 * <head>. For ~8 tags, upserting them directly is simpler and has no
 * bundler-interop failure mode to hit.
 *
 * `noindex` is for pages with no independent search value: thin stubs,
 * anything behind auth, personal/session-scoped views. A crawler that
 * reaches one of these should be told not to index it rather than left to
 * guess from a login wall or empty state.
 */
interface SeoProps {
  /** Page-specific title fragment. Rendered as "{title} | Artifact Armoury"
   *  unless it already equals SITE_NAME (used for the homepage). */
  title: string
  description?: string
  /** Canonical path, e.g. "/browse". Defaults to the current URL path. */
  path?: string
  noindex?: boolean
  image?: string
}

const DEFAULT_DESCRIPTION =
  'Browse 3D-printable tabletop terrain STLs from independent artists, plan your board in the free 3D table planner, and buy each file once — print it as many times as your table needs.'

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

const Seo: React.FC<SeoProps> = ({ title, description, path, noindex, image }) => {
  useEffect(() => {
    const fullTitle = title === SITE_NAME ? title : `${title} | ${SITE_NAME}`
    const desc = description ?? DEFAULT_DESCRIPTION
    const origin = window.location.origin
    const canonicalPath = path ?? window.location.pathname
    const canonicalUrl = `${origin}${canonicalPath}`
    const ogImage = image ?? `${origin}/og-image.png`

    document.title = fullTitle
    upsertMeta('name', 'description', desc)
    upsertMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow')
    upsertLink('canonical', canonicalUrl)
    upsertMeta('property', 'og:title', fullTitle)
    upsertMeta('property', 'og:description', desc)
    upsertMeta('property', 'og:url', canonicalUrl)
    upsertMeta('property', 'og:image', ogImage)
    upsertMeta('name', 'twitter:title', fullTitle)
    upsertMeta('name', 'twitter:description', desc)
  }, [title, description, path, noindex, image])

  return null
}

export default Seo
