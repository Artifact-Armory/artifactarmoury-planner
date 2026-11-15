// /artists/:slug: give link previews the artist's own name, bio and image.
// See functions-lib/meta.ts for why.
import { SITE, SITE_NAME, apiJson, assetUrl, plain, safePage, shell, withMeta } from '../../functions-lib/meta'

export const onRequestGet = safePage(async (context: any): Promise<Response> => {
  const page = await shell(context)
  const slug = String(context.params?.slug ?? '')
  if (!/^[a-z0-9-]{1,100}$/i.test(slug)) return page
  const data = await apiJson(context.env, `/api/artists/${encodeURIComponent(slug)}`)
  const a = data?.artist
  if (!a?.name) return page
  return withMeta(page, {
    title: `${a.name}: 3D printable STLs | ${SITE_NAME}`,
    description: plain(a.bio || `Tabletop terrain and models by ${a.name} on ${SITE_NAME}.`),
    url: `${SITE}/artists/${a.slug || slug}`,
    image: assetUrl(context.env, a.banner_image_url || a.profile_image_url),
    type: 'profile',
  })
})
