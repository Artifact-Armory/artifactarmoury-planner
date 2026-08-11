import React from 'react'

/**
 * Non-affiliation / nominative-use notice. Shown site-wide in the footer and
 * contextually wherever third-party game names appear (the "Can be used with"
 * compatibility tags), to make clear the names are used only descriptively and
 * imply no affiliation or endorsement.
 */
export const TRADEMARK_DISCLAIMER =
  'Artifact Armoury is an independent marketplace and is not affiliated with, endorsed by, or ' +
  'sponsored by any game publisher. All game and product names are trademarks or registered ' +
  'trademarks of their respective owners, used only to describe scale and compatibility.'

/**
 * Common third-party game / franchise trademarks a shopper might type into search.
 * Lower-cased, matched as substrings — not exhaustive, it only needs to catch the
 * usual ones so the non-affiliation notice surfaces on those searches. Erring
 * toward showing the notice is harmless.
 */
const TRADEMARK_KEYWORDS = [
  'warhammer', 'games workshop', '40k', '40,000', 'kill team', 'kill-team', 'necromunda',
  'underhive', 'horus heresy', 'age of sigmar', 'sigmar', 'warcry', 'mordheim',
  'bolt action', 'flames of war', 'team yankee', 'star wars', 'crisis protocol', 'marvel',
  'fallout', 'gaslands', 'frostgrave', 'stargrave', 'malifaux', 'walking dead', 'battletech',
]

/** True if free text mentions a known trademarked game/franchise name. */
export function mentionsTrademark(text: string | null | undefined): boolean {
  if (!text) return false
  const q = text.toLowerCase()
  return TRADEMARK_KEYWORDS.some((k) => q.includes(k))
}

const TrademarkDisclaimer: React.FC<{ className?: string }> = ({ className }) => (
  <p className={className ?? 'text-xs text-muted-foreground'}>{TRADEMARK_DISCLAIMER}</p>
)

export default TrademarkDisclaimer
