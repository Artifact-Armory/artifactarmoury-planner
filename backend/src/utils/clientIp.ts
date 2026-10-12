// backend/src/utils/clientIp.ts
// Who is actually making a request, for rate limiting and logs.
//
// The API runs behind Railway's edge proxy, and possibly Cloudflare in front of that.
// Without `trust proxy` Express reports the proxy's own address as `req.ip`, so every
// visitor shared one rate-limit bucket: 15 failed logins from anyone locked logins for
// everyone, and a busy planner session could exhaust the site-wide request budget.
//
// Two rules keep this spoof-proof without depending on exactly how Railway writes its
// forwarding headers (its own staff disagree on that):
//  1. Only INTERNAL addresses are trusted as proxy hops (loopback, private, link-local
//     and carrier-grade NAT — the 100.64.0.0/10 range Railway uses inside its network).
//     Express walks X-Forwarded-For from the right and stops at the first public
//     address. A visitor can only add entries to the LEFT of what the edge records,
//     so they can never move that stopping point.
//  2. If the address found is one of Cloudflare's, the real visitor is in
//     CF-Connecting-IP, which Cloudflare always overwrites. A request that didn't come
//     through Cloudflare can't arrive from a Cloudflare address, so it can't use this.

import ipaddr from 'ipaddr.js'
import type { Request } from 'express'

const INTERNAL_V4 = new Set(['loopback', 'private', 'linkLocal', 'carrierGradeNat', 'unspecified'])
const INTERNAL_V6 = new Set(['loopback', 'uniqueLocal', 'linkLocal', 'unspecified'])

function parse(addr: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  try {
    // process() turns an IPv4-mapped IPv6 address (::ffff:10.0.0.1) back into IPv4.
    return ipaddr.process(addr.trim())
  } catch {
    return null
  }
}

/** Express `trust proxy` function: trust a hop only if its address is internal. */
export function trustInternalProxies(addr: string): boolean {
  const ip = parse(addr)
  if (!ip) return false
  return ip.kind() === 'ipv4' ? INTERNAL_V4.has(ip.range()) : INTERNAL_V6.has(ip.range())
}

// Cloudflare's published ranges (cloudflare.com/ips, last changed 2023-09-28).
// CLOUDFLARE_IP_RANGES (comma-separated CIDRs) replaces the list if they change.
const DEFAULT_CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
]

const cloudflareRanges = (process.env.CLOUDFLARE_IP_RANGES?.split(',') ?? DEFAULT_CLOUDFLARE_RANGES)
  .map((cidr) => cidr.trim())
  .filter(Boolean)
  .map((cidr) => ipaddr.parseCIDR(cidr))

function isCloudflare(ip: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  return cloudflareRanges.some(
    ([range, bits]) => range.kind() === ip.kind() && (ip as ipaddr.IPv4).match(range as ipaddr.IPv4, bits),
  )
}

/** The visitor's IP address, as best this request can prove it. */
export function clientIp(req: Request): string {
  const peer = req.ip ?? req.socket?.remoteAddress ?? ''
  const ip = parse(peer)
  if (ip && isCloudflare(ip)) {
    const header = req.headers['cf-connecting-ip']
    const viaCloudflare = typeof header === 'string' ? parse(header) : null
    if (viaCloudflare) return viaCloudflare.toString()
  }
  return ip ? ip.toString() : peer
}

/**
 * A rate-limit key for the visitor's address. IPv6 is keyed by its /64, because one
 * home connection is normally handed a whole /64 and could otherwise rotate through
 * addresses to dodge a limit.
 */
export function clientIpKey(req: Request): string {
  const ip = parse(clientIp(req))
  if (!ip) return `ip:${clientIp(req)}`
  if (ip.kind() === 'ipv4') return `ip:${ip.toString()}`
  const parts = (ip as ipaddr.IPv6).parts.slice(0, 4).map((p) => p.toString(16))
  return `ip6:${parts.join(':')}::/64`
}
