// Runs in front of every page request (not images/scripts: see
// public/_routes.json). Three SEO jobs:
//
// 1. www.artifactarmoury.com -> artifactarmoury.com (one address for Google).
// 2. The *.pages.dev copy of the site is marked "noindex" so it can't compete
//    with the real domain in search results.
// 3. Every page gets its own title, description and canonical address in the
//    HTML itself. The React app sets these too (components/common/Seo.tsx), but
//    only after JavaScript runs; before that, every page claimed to be the
//    homepage. Keep the titles below in step with each page's <Seo>.
//
// /models/:id and /artists/:slug have their own functions and are left alone.
import { SITE, SITE_NAME, safePage, withMeta, type PageMeta } from '../functions-lib/meta'
import { topicBySlug, topicPath } from '../src/seo/topics'

const PAGES: Record<string, { title: string; description: string }> = {
  '/browse': {
    title: 'Browse Tabletop Terrain STLs',
    description:
      'Browse print-ready tabletop terrain, vehicles and character STLs from artists and studios. Filter by scale, era and print process, then plan your table in 3D before you buy.',
  },
  '/planner': {
    title: 'Free 3D Tabletop Terrain Planner',
    description:
      'Plan your wargaming table in 3D before you print. Add terrain STLs to a virtual board, stack and rotate pieces, then push the whole build into your cart. No account required.',
  },
  '/tables': {
    title: 'Explore the Table: Artist and Community Tables',
    description:
      'Browse tabletop layouts artists and other builders have shared in the 3D planner. See a full board planned in terrain STLs and open any model straight from the table.',
  },
  '/artists': {
    title: 'Terrain Artists',
    description:
      'Discover artists and studios making 3D-printable tabletop terrain. Browse their storefronts and follow to stay up to date with new releases.',
  },
  '/bundles': {
    title: 'Terrain Bundles',
    description:
      'Multi-model terrain bundles from artists and studios: several STLs grouped at one price. Buy once and download every file in the set.',
  },
  '/about': {
    title: 'About Us',
    description:
      'Artifact Armoury is a marketplace and free 3D planner for tabletop terrain. Buy print-ready STL models from artists and studios, plan your table before you print, and sell your own work with anti-theft protection built in.',
  },
  '/become-an-artist': {
    title: 'Become an Artist',
    description:
      'Sell your 3D printable terrain, vehicles and miniatures on Artifact Armoury. How to apply, what you earn, how you get paid and the rules for sellers.',
  },
  '/creator-protection': {
    title: 'How We Protect Your Models',
    description:
      "Per-buyer watermarking, shape fingerprinting, and unprintable preview meshes: how Artifact Armoury protects artists' STL files from theft and re-upload.",
  },
  '/contact': {
    title: 'Contact Us',
    description: `Get in touch with ${SITE_NAME} about an order, a download issue, or general feedback.`,
  },
}

// Pages with nothing for a searcher: logins, account areas, private tables.
const NOINDEX = /^\/(login|register|forgot-password|reset-password|verify-email|checkout|dashboard|artist|admin|library|categories|tags)(\/|$)|^\/planner\/./

function metaFor(pathname: string): PageMeta | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const url = `${SITE}${path === '/' ? '/' : path}`
  if (path === '/') return null // the shell already describes the homepage
  if (/^\/models\/[^/]+$/.test(path) || /^\/artists\/[^/]+$/.test(path)) return null
  if (NOINDEX.test(path)) return { url, noindex: true }
  const topic = path.startsWith('/stl/') ? topicBySlug(path.slice(5)) : undefined
  if (topic) return { url: `${SITE}${topicPath(topic)}`, title: `${topic.title} | ${SITE_NAME}`, description: topic.description }
  const page = PAGES[path]
  if (page) return { url, title: `${page.title} | ${SITE_NAME}`, description: page.description }
  return { url } // any other page: at least stop it claiming to be the homepage
}

export const onRequest = safePage(async (context: any): Promise<Response> => {
  const url = new URL(context.request.url)

  if (url.hostname === 'www.artifactarmoury.com') {
    return Response.redirect(`${SITE}${url.pathname}${url.search}`, 301)
  }

  let res: Response = await context.next()
  const isHtml = (res.headers.get('content-type') || '').includes('text/html')
  if (context.request.method === 'GET' && isHtml) {
    const meta = metaFor(url.pathname)
    if (meta) res = withMeta(res, meta)
  }

  if (url.hostname.endsWith('.pages.dev')) {
    res = new Response(res.body, res)
    res.headers.set('X-Robots-Tag', 'noindex')
  }
  return res
})
