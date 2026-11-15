// Topic landing pages (/stl/<slug>): one indexable page per thing people
// actually search for ("WW2 tank STL", "28mm WW2 miniatures STL"...).
//
// /browse can't do this job: every filter combination canonicalises to
// /browse, so Google sees one page. Each topic here is a fixed filter with its
// own URL, title, heading and intro.
//
// Shared by the React page (pages/Topic.tsx), the Cloudflare Pages Functions
// (functions/_middleware.ts, sitemap) — so keep it plain data: no imports.
//
// Only add a topic the catalogue can fill (aim for 8+ listings). `terms` uses
// the same facet syntax as /browse?terms=.

export interface Topic {
  slug: string
  /** Short name for links and chips. */
  label: string
  /** <title> (the site name is appended). Keep under ~50 characters. */
  title: string
  /** Page heading. */
  h1: string
  /** Meta description, ~150 characters. */
  description: string
  /** Intro paragraph shown under the heading. */
  intro: string
  /** /browse `terms` filter. */
  terms: string
}

const WW2 = 'setting-era:historical/world-war-two'

export const TOPICS: Topic[] = [
  {
    slug: 'ww2-wargaming',
    label: 'WW2',
    title: 'WW2 Wargaming STL Files: Tanks, Infantry & Terrain',
    h1: 'WW2 wargaming STL files',
    description:
      '3D printable WW2 tanks, infantry, guns and terrain from independent artists. Download STL files for 28mm, 20mm (1:72) and 15mm wargaming and print as many as you need.',
    intro:
      'Tanks, infantry, artillery, bunkers and battlefield terrain for World War Two tabletop wargames. Every model is a digital STL file from an independent artist: buy it once, download it straight away and print as many as your table needs.',
    terms: WW2,
  },
  {
    slug: 'ww2-tanks',
    label: 'WW2 tanks',
    title: 'WW2 Tank STL Files for 3D Printing',
    h1: 'WW2 tank STL files',
    description:
      '3D printable WW2 tanks and armoured vehicles: Shermans, Panzers and more. STL files for 28mm, 20mm (1:72) and 15mm wargaming from independent artists.',
    intro:
      'Shermans, Panzers, tank destroyers and other armoured fighting vehicles of the Second World War, ready for resin or filament printers. Check each listing for its design scale; most can be resized in your slicer to match your army.',
    terms: `${WW2},vehicle-type:armour-and-fighting-vehicles`,
  },
  {
    slug: 'ww2-german',
    label: 'WW2 German',
    title: 'WW2 German STL Files: Panzers, Infantry & Guns',
    h1: 'WW2 German STL files',
    description:
      '3D printable WW2 German tanks, infantry and artillery for tabletop wargaming. STL downloads from independent artists, in 28mm, 20mm and 15mm.',
    intro:
      'German armour, infantry, support weapons and artillery for WW2 wargaming, from early-war Panzers to late-war heavy tanks. All are STL downloads you print yourself.',
    terms: `${WW2},side-nation:ww2-axis/germany`,
  },
  {
    slug: 'ww2-allied',
    label: 'WW2 Allies',
    title: 'WW2 Allied STL Files: US, British & Soviet',
    h1: 'WW2 Allied STL files',
    description:
      '3D printable WW2 US, British and Soviet tanks, infantry and vehicles for tabletop wargaming. STL downloads from independent artists.',
    intro:
      'American, British and Soviet tanks, infantry, paratroopers and support vehicles for WW2 wargaming. Buy the STL once and print whole platoons.',
    terms: `${WW2},side-nation:ww2-allies`,
  },
  {
    slug: 'ww1-wargaming',
    label: 'WW1 & interwar',
    title: 'WW1 & Interwar Wargaming STL Files',
    h1: 'WW1 and interwar wargaming STL files',
    description:
      '3D printable WW1 and interwar miniatures, vehicles and trench terrain: Freikorps, early armoured cars, field guns and more. STL files from independent artists.',
    intro:
      'Miniatures, vehicles and trench terrain for the Great War and the conflicts that followed it: Freikorps, revolutionaries, early armoured cars and field guns. A period few shops cover, sculpted by specialist artists.',
    terms: 'setting-era:historical/world-war-one,setting-era:historical/interwar',
  },
  {
    slug: 'cold-war',
    label: 'Cold War',
    title: 'Cold War Wargaming STL Files: Tanks & Vehicles',
    h1: 'Cold War wargaming STL files',
    description:
      '3D printable Cold War tanks and vehicles for tabletop wargaming. STL downloads from independent artists, ready for resin or filament printers.',
    intro:
      'Main battle tanks, personnel carriers and support vehicles for Cold War and modern tabletop wargames. Digital STL files you print yourself, as many times as you like.',
    terms: 'setting-era:historical/cold-war',
  },
  {
    slug: 'trenches-bunkers-fortifications',
    label: 'Trenches & bunkers',
    title: 'Trench, Bunker & Fortification Terrain STL Files',
    h1: 'Trench, bunker and fortification terrain STL files',
    description:
      '3D printable trenches, bunkers, tank traps and field fortifications for wargaming tables. STL terrain from independent artists that you can lay out in a free 3D planner first.',
    intro:
      'Trench systems, concrete bunkers, tank traps, barricades and field obstacles for historical and sci-fi tables. Try the pieces on a 3D table in the planner before you buy, so you know how many of each to print.',
    terms: 'terrain-type:fortifications-and-military-works',
  },
  {
    slug: 'wargaming-terrain',
    label: 'Terrain',
    title: '3D Printable Wargaming Terrain STL Files',
    h1: '3D printable wargaming terrain',
    description:
      '3D printable wargaming terrain: buildings, ruins, trenches, bunkers and scatter. STL files from independent artists, with a free 3D table planner to lay out your board before you print.',
    intro:
      'Buildings, ruins, fortifications, scatter and modular boards for tabletop wargames. Lay the pieces out on a 3D table in the free planner, see what fits, then buy only the STL files you need.',
    terms: 'model-class:terrain',
  },
  {
    slug: 'sci-fi-terrain',
    label: 'Sci-fi',
    title: 'Sci-Fi Wargaming Terrain STL Files',
    h1: 'Sci-fi wargaming terrain STL files',
    description:
      '3D printable sci-fi terrain for tabletop wargames: grimdark and cyberpunk city ruins, industrial sets and modular scenery. STL files from independent artists.',
    intro:
      'Modular industrial cities, grimdark ruins and cyberpunk scenery for science fiction skirmish and wargames. Build the layout in the 3D planner first, then print the set.',
    terms: 'setting-era:science-fiction',
  },
  {
    slug: '28mm-miniatures',
    label: '28mm miniatures',
    title: '28mm Wargaming Miniatures STL Files',
    h1: '28mm wargaming miniature STL files',
    description:
      '3D printable 28mm miniatures for historical wargaming: infantry, weapon teams, officers and cavalry. Resin-ready STL files from independent sculptors.',
    intro:
      'Infantry squads, weapon teams, officers and riders sculpted for 28mm (1:56) wargaming. Most are designed for resin printers and many include alternate heads or weapons.',
    terms: 'model-class:characters,scale:28mm',
  },
  {
    slug: '20mm-1-72-scale',
    label: '20mm (1:72)',
    title: '20mm & 1:72 Scale Wargaming STL Files',
    h1: '20mm and 1:72 scale wargaming STL files',
    description:
      '3D printable 20mm (1:72 and 1:76) tanks and vehicles for wargaming and scale modelling. STL downloads from independent artists.',
    intro:
      'Tanks and vehicles designed at 20mm, the classic 1:72 and 1:76 scale for wargaming and model making. Print them as they come, or resize in your slicer for other scales.',
    terms: 'scale:20mm',
  },
]

export const topicBySlug = (slug: string | undefined): Topic | undefined =>
  TOPICS.find((t) => t.slug === slug)

export const topicPath = (t: Topic): string => `/stl/${t.slug}`
