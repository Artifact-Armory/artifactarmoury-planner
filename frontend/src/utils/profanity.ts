// frontend/src/utils/profanity.ts
// Client mirror of the backend abuse filter (backend/src/services/profanity.ts) for
// instant feedback. The SERVER is authoritative — this just avoids a round-trip and
// warns the user as they try to send. Keep the term list in sync with the backend.

export const ABUSE_BLOCK_MESSAGE =
  "You can't use abusive language. Please keep messages respectful."

const BANNED_TERMS: string[] = [
  'fuck', 'fucks', 'fucked', 'fucking', 'fuckin', 'fucker', 'fuckers', 'fuckface',
  'fuckwit', 'motherfucker', 'motherfuckers', 'motherfucking', 'clusterfuck',
  'shit', 'shits', 'shite', 'shitty', 'shitting', 'shithead', 'bullshit', 'dipshit',
  'cunt', 'cunts',
  'bitch', 'bitches', 'bitching',
  'asshole', 'assholes', 'arsehole', 'arseholes',
  'bastard', 'bastards',
  'dick', 'dickhead', 'dickheads',
  'prick', 'pricks',
  'cock', 'cocks', 'cocksucker', 'cocksuckers',
  'pussy', 'pussies',
  'wanker', 'wankers', 'wank',
  'twat', 'twats',
  'bollocks',
  'slut', 'sluts',
  'whore', 'whores',
  'piss', 'pissed',
  'douchebag',
  'nigger', 'niggers', 'nigga', 'niggas',
  'faggot', 'faggots', 'fag', 'fags',
  'coon', 'coons',
  'chink', 'chinks',
  'spic', 'spics',
  'kike', 'kikes',
  'gook', 'gooks',
  'wetback', 'wetbacks',
  'beaner', 'beaners',
  'paki', 'pakis',
  'tranny', 'trannies',
  'dyke', 'dykes',
  'retard', 'retards', 'retarded',
]

function normalizeLeet(input: string): string {
  return input
    .toLowerCase()
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/!/g, 'i')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
}

function escapeRegex(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const ABUSE_REGEX: RegExp = (() => {
  const alternatives = BANNED_TERMS.map((word) =>
    word.split('').map(escapeRegex).join('[^a-z]*'),
  )
  // Leading (?:^|[^a-z]) instead of a lookbehind — avoids lookbehind syntax that
  // older Safari can't parse (would throw at import). Boundary-safe for a boolean test.
  return new RegExp(`(?:^|[^a-z])(?:${alternatives.join('|')})(?![a-z])`, 'i')
})()

export function containsAbuse(text: string): boolean {
  if (!text) return false
  return ABUSE_REGEX.test(normalizeLeet(text))
}
