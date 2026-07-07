// Unit test for the cross-artist collaboration publish gate (migration 018).
// Exercises the pure decision logic (no DB). The service module eagerly loads the
// db layer, so flip on DB_MOCK before requiring it (avoids a DATABASE_URL check).
// Run: npm run test:collab
process.env.DB_MOCK = 'true'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { computeBlockers } = require('../src/services/collaborations') as typeof import('../src/services/collaborations')
type ForeignArtist = import('../src/services/collaborations').ForeignArtist

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`) }
  else { failed++; console.error(`  ✗ ${msg}`) }
}

const artistB: ForeignArtist = {
  collaboratorId: 'B',
  name: 'Artist B',
  models: [
    { id: 'm1', name: 'Ruined Tower', thumbnail: null },
    { id: 'm2', name: 'Broken Wall', thumbnail: null },
  ],
}

type Row = { status: 'pending' | 'accepted' | 'declined'; approve_all: boolean; approved: string[] }
const map = (entries: Array<[string, Row]>) => new Map(entries)

console.log('No foreign artists → never blocked')
assert(computeBlockers([], map([])).length === 0, 'empty layout is publishable')

console.log('Foreign artist with no collaboration row → blocked (pending)')
{
  const b = computeBlockers([artistB], map([]))
  assert(b.length === 1 && b[0].reason === 'pending', 'missing row blocks as pending')
  assert(b[0].modelNames.length === 2, 'lists both of B’s models')
}

console.log('Pending request → blocked')
assert(
  computeBlockers([artistB], map([['B', { status: 'pending', approve_all: false, approved: [] }]]))[0]?.reason === 'pending',
  'pending status blocks',
)

console.log('Declined → blocked (declined)')
assert(
  computeBlockers([artistB], map([['B', { status: 'declined', approve_all: false, approved: [] }]]))[0]?.reason === 'declined',
  'declined status blocks',
)

console.log('Accepted all → publishable')
assert(
  computeBlockers([artistB], map([['B', { status: 'accepted', approve_all: true, approved: [] }]])).length === 0,
  'approve_all clears the gate',
)

console.log('Accepted subset covering every placed model → publishable')
assert(
  computeBlockers([artistB], map([['B', { status: 'accepted', approve_all: false, approved: ['m1', 'm2'] }]])).length === 0,
  'full subset clears the gate',
)

console.log('Accepted subset missing one placed model → blocked (unapproved-models)')
{
  const b = computeBlockers([artistB], map([['B', { status: 'accepted', approve_all: false, approved: ['m1'] }]]))
  assert(b.length === 1 && b[0].reason === 'unapproved-models', 'partial subset blocks')
  assert(b[0].modelNames.length === 1 && b[0].modelNames[0] === 'Broken Wall', 'names only the unapproved model')
}

console.log('Two foreign artists, one accepted + one pending → one blocker')
{
  const artistC: ForeignArtist = { collaboratorId: 'C', name: 'Artist C', models: [{ id: 'm3', name: 'Barrel', thumbnail: null }] }
  const b = computeBlockers([artistB, artistC], map([['B', { status: 'accepted', approve_all: true, approved: [] }]]))
  assert(b.length === 1 && b[0].collaboratorId === 'C', 'only the un-accepted artist blocks')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
