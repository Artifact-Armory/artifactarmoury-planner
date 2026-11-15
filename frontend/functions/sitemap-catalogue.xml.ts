// /sitemap-catalogue.xml: every published model and artist page, built live
// from the public API so new listings reach Google without editing a file.
// Listed in the sitemap index at public/sitemap.xml.
import { SITE, apiJson, esc } from '../functions-lib/meta'
import { TOPICS, topicPath } from '../src/seo/topics'

export const onRequestGet = async (context: any): Promise<Response> => {
  const urls: { loc: string; lastmod?: string }[] = []

  // Topic landing pages (/stl/...), from the shared list.
  for (const t of TOPICS) urls.push({ loc: `${SITE}${topicPath(t)}` })

  for (let page = 1; page <= 20; page++) {
    const data = await apiJson(context.env, `/api/browse?limit=200&page=${page}`, 5000)
    const models: any[] = data?.models ?? []
    for (const m of models) {
      urls.push({ loc: `${SITE}/models/${m.id}`, lastmod: m.published_at ? String(m.published_at).slice(0, 10) : undefined })
    }
    const pages = Number(data?.pagination?.pages ?? 1)
    if (!models.length || page >= pages) break
  }

  const artists = await apiJson(context.env, '/api/artists', 5000)
  for (const a of artists?.artists ?? []) {
    // Skip internal test accounts.
    if (!a?.slug || /^tester/i.test(String(a.name ?? ''))) continue
    urls.push({ loc: `${SITE}/artists/${a.slug}` })
  }

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
      .join('\n') +
    '\n</urlset>\n'

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
