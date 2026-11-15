// /models/:id: give link previews (Reddit, Discord, Facebook…) the model's own
// name, photo and price. See functions-lib/meta.ts for why.
import { SITE, SITE_NAME, apiJson, assetUrl, plain, price, safePage, shell, withMeta } from '../../functions-lib/meta'

export const onRequestGet = safePage(async (context: any): Promise<Response> => {
  const page = await shell(context)
  const id = String(context.params?.id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return page
  const data = await apiJson(context.env, `/api/models/${id}`)
  const m = data?.model
  if (!m || (m.status && m.status !== 'published')) return page
  const by = m.artist_name ? ` by ${m.artist_name}` : ''
  // The price a buyer pays today (the sale price while a sale is on).
  const now = m.on_sale && m.sale_price != null ? m.sale_price : m.base_price
  const cost = price(now)
  const url = `${SITE}/models/${id}`
  const image = assetUrl(context.env, m.thumbnail_path)
  const description = plain(`${cost ? `${cost}. ` : ''}${m.description || `3D printable STL${by}.`}`)

  // Structured data: lets Google show the price (and later the rating) in results.
  const reviews = Number(m.review_count ?? 0)
  const product: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: m.name,
    description: plain(m.description || `3D printable STL${by}.`, 500),
    url,
    category: '3D printable STL file',
    ...(image ? { image } : {}),
    ...(m.artist_name ? { brand: { '@type': 'Brand', name: m.artist_name } } : {}),
    ...(reviews > 0 && Number(m.average_rating) > 0
      ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(m.average_rating), reviewCount: reviews } }
      : {}),
    ...(Number.isFinite(Number(now)) && !m.sales_disabled
      ? {
          offers: {
            '@type': 'Offer',
            url,
            price: Number(now).toFixed(2),
            priceCurrency: 'GBP',
            availability: 'https://schema.org/InStock',
            seller: { '@type': 'Organization', name: SITE_NAME },
          },
        }
      : {}),
  }
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Browse', item: `${SITE}/browse` },
      ...(m.artist_name && m.artist_slug
        ? [{ '@type': 'ListItem', position: 2, name: m.artist_name, item: `${SITE}/artists/${m.artist_slug}` }]
        : []),
      { '@type': 'ListItem', position: m.artist_name && m.artist_slug ? 3 : 2, name: m.name, item: url },
    ],
  }

  return withMeta(page, {
    title: `${m.name}${by} | ${SITE_NAME}`,
    description,
    url,
    image,
    type: 'product',
    jsonLd: [product, crumbs],
  })
})
