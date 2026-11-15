// Shared helpers for the Cloudflare Pages Functions in ../functions.
//
// Why these exist: the site is a single-page app, so every URL is served the
// same index.html and each page's title/description/image is only set later by
// JavaScript (components/common/Seo.tsx). Google runs that JavaScript, but the
// link-preview bots of Reddit, Discord, Facebook, WhatsApp, X etc. don't — so a
// shared model link showed only "Artifact Armoury" and the site logo.
// These functions put the page's own title, description and image into the
// HTML before it leaves Cloudflare. The page itself is unchanged for people.
//
// Plain types (no @cloudflare/workers-types dependency); HTMLRewriter is a
// global in the Pages runtime.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const HTMLRewriter: any

export const SITE = 'https://artifactarmoury.com'
export const SITE_NAME = 'Artifact Armoury'
const DEFAULT_API = 'https://confident-purpose-production-3e3f.up.railway.app'
const DEFAULT_ASSETS = 'https://assets.artifactplanner.com'

export function apiBase(env: any): string {
  return String(env?.API_BASE_URL || env?.VITE_API_BASE_URL || DEFAULT_API).replace(/\/$/, '')
}

export function assetUrl(env: any, p?: string | null): string | undefined {
  if (!p) return undefined
  if (/^https?:\/\//.test(p)) return p
  const base = String(env?.ASSET_BASE_URL || env?.VITE_ASSET_BASE_URL || DEFAULT_ASSETS).replace(/\/$/, '')
  return `${base}/${p.replace(/^\/+/, '')}`
}

/** Fetch JSON from the API with a short timeout; null on any failure. */
export async function apiJson(env: any, path: string, timeoutMs = 2500): Promise<any | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${apiBase(env)}${path}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 300, cacheEverything: true },
    } as any)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/** Collapse markdown-ish text to one plain line of at most `max` characters. */
export function plain(text: string | null | undefined, max = 200): string {
  const s = String(text ?? '')
    .replace(/[#*_`>\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

export interface PageMeta {
  /** Omit to keep the shell's own title/description (only the URL tags change). */
  title?: string
  description?: string
  url: string
  image?: string
  type?: string
  /** Tell search engines not to index this page (logins, account pages…). */
  noindex?: boolean
  /** schema.org objects to add as JSON-LD (product, breadcrumbs…). */
  jsonLd?: unknown[]
}

/**
 * The SPA shell (index.html). context.next() serves it through the
 * `/* /index.html 200` rule in public/_redirects; fall back to fetching it
 * directly if that ever returns something else.
 */
export async function shell(context: any): Promise<Response> {
  const res: Response = await context.next()
  if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) return res
  return context.env.ASSETS.fetch(new URL('/index.html', context.request.url).toString())
}

/** Rewrite the shell's <head> tags to describe this page. */
export function withMeta(res: Response, meta: PageMeta): Response {
  const set = (value: string | undefined) => ({
    element(el: any) { if (value !== undefined) el.setAttribute('content', value) },
  })
  const image = meta.image
  return new HTMLRewriter()
    .on('title', { element(el: any) { if (meta.title) el.setInnerContent(meta.title) } })
    .on('meta[name="description"]', set(meta.description))
    .on('link[rel="canonical"]', { element(el: any) { el.setAttribute('href', meta.url) } })
    .on('meta[property="og:type"]', set(meta.type))
    .on('meta[property="og:title"]', set(meta.title))
    .on('meta[property="og:description"]', set(meta.description))
    .on('meta[property="og:url"]', set(meta.url))
    .on('meta[property="og:image"]', set(image))
    .on('head', {
      element(el: any) {
        // Not in the shell, so add them once here.
        const add = (html: string) => el.append(html, { html: true })
        if (meta.title) add(`<meta name="twitter:title" content="${esc(meta.title)}" />`)
        if (meta.description) add(`<meta name="twitter:description" content="${esc(meta.description)}" />`)
        if (image) add(`<meta name="twitter:image" content="${esc(image)}" />`)
        if (meta.noindex) add('<meta name="robots" content="noindex, nofollow" />')
        for (const obj of meta.jsonLd ?? []) {
          // "<" is escaped so text from a listing can never close the script tag.
          add(`<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`)
        }
      },
    })
    .transform(res)
}

/**
 * Run a page handler, but never let a bug or an API outage break the page:
 * on any error, serve the normal SPA shell exactly as before.
 */
export function safePage(handler: (context: any) => Promise<Response>) {
  return async (context: any): Promise<Response> => {
    try {
      return await handler(context)
    } catch {
      return context.next()
    }
  }
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function price(n: unknown): string | null {
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  return v === 0 ? 'Free' : `£${v.toFixed(2)}`
}
