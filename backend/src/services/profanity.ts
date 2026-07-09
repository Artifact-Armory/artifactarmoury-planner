// backend/src/services/profanity.ts
// Lightweight abuse/profanity gate for user-authored messages. This is a moderate
// bar (common swears + racial/identity slurs), NOT an exhaustive filter — it blocks
// the obvious cases and warns the user. It is authoritative: the frontend mirrors it
// for instant feedback, but the server decision is what counts.
//
// Matching is boundary-aware to avoid the "Scunthorpe problem" (a banned word sitting
// inside an innocent one). We also fold common leetspeak and tolerate separators
// between letters (f.u.c.k, c*u*n*t, "s h i t") so trivial obfuscation still trips.

export const ABUSE_BLOCK_MESSAGE =
  "Your message can't be sent because it contains abusive language. Please keep messages respectful.";

// Base terms + the common inflections we care about. Kept explicit (rather than fancy
// stemming) so it's easy to read and tweak.
const BANNED_TERMS: string[] = [
  // strong profanity
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
  // racial / ethnic / identity slurs
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
];

// Fold obvious leetspeak to letters so "sh1t" / "f@g" / "n1gg3r" are caught.
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
    .replace(/5/g, 's');
}

function escapeRegex(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build one regex: each banned word's letters may be separated by any run of
// non-letter characters (spaces, punctuation), and the whole match must sit on
// letter boundaries so it can't hide inside a normal word.
const ABUSE_REGEX: RegExp = (() => {
  const alternatives = BANNED_TERMS.map((word) =>
    word.split('').map(escapeRegex).join('[^a-z]*'),
  );
  // Leading (?:^|[^a-z]) instead of a lookbehind keeps this boundary-safe without
  // lookbehind syntax (parity with the frontend mirror).
  return new RegExp(`(?:^|[^a-z])(?:${alternatives.join('|')})(?![a-z])`, 'i');
})();

/** True if the text contains disallowed abusive language. */
export function containsAbuse(text: string): boolean {
  if (!text) return false;
  return ABUSE_REGEX.test(normalizeLeet(text));
}
