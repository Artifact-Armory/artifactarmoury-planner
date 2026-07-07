// backend/src/data/taxonomy.ts
//
// The authored marketplace taxonomy — the single source of truth for the seed
// script (scripts/seed-taxonomy.ts). Ten facets; every facet is multi-value, the
// type/setting facets are hierarchical, and the whole thing lives in the DB so
// new terms are an admin insert, not a redeploy. Slugs are derived from names and
// are IMMUTABLE once seeded (URLs + saved filters depend on them) — rename the
// `name`, never let a term's position in the tree change its slug.

export interface TermSeed {
  name: string
  slug?: string // override the auto-derived slug (rare)
  synonyms?: string[] // search-only, never displayed
  ratio?: string // scale facet only
  children?: TermSeed[]
}

export interface FacetSeed {
  slug: string
  name: string
  description?: string
  selectionUi: 'tree' | 'chips' | 'grouped' | 'flat'
  required?: boolean
  maxTerms?: number
  terms: TermSeed[]
}

/** Branch helper: children may be plain strings (leaves) or nested TermSeeds. */
const t = (name: string, children?: Array<string | TermSeed>): TermSeed => ({
  name,
  children: children?.map((c) => (typeof c === 'string' ? { name: c } : c)),
})

/** Scale leaf with its ratio attribute. */
const scale = (name: string, ratio?: string): TermSeed => ({ name, ratio })

export const TAXONOMY: FacetSeed[] = [
  // ==========================================================================
  // 1 · TERRAIN TYPE — the primary "what is it" tree
  // ==========================================================================
  {
    slug: 'terrain-type',
    name: 'Terrain Type',
    description: 'What the model physically is.',
    selectionUi: 'tree',
    required: true,
    maxTerms: 6,
    terms: [
      t('Buildings', [
        t('Residential', [
          'Cottages & Farmhouses',
          'Townhouses & Terraces',
          'Tenements & Apartment Blocks',
          'Suburban Houses',
          'Manors, Mansions & Estates',
          'Villas',
          'Huts, Shacks & Hovels',
          'Slums & Shanties',
          'Longhouses & Roundhouses',
          'High-rise Residential',
        ]),
        t('Commercial', [
          'Shops & Storefronts',
          'Taverns, Inns & Pubs',
          'Markets, Bazaars & Stalls',
          'Cafés, Restaurants & Diners',
          'Hotels & Motels',
          'Banks',
          'Offices & Office Blocks',
          'Petrol / Gas Stations',
          'Theatres & Cinemas',
        ]),
        t('Civic & Institutional', [
          'Town Halls',
          'Courthouses',
          'Schools',
          'Libraries',
          'Hospitals & Clinics',
          'Police & Fire Stations',
          'Prisons & Jails',
          'Museums',
          'Post Offices',
        ]),
        t('Religious & Funerary', [
          'Churches & Chapels',
          'Cathedrals',
          'Temples',
          'Shrines',
          'Mosques & Minarets',
          'Monasteries & Abbeys',
          'Pagodas',
          'Mausoleums & Crypts',
          'Lychgates',
        ]),
        t('Agricultural', [
          'Barns',
          'Stables',
          'Granaries',
          'Windmills',
          'Watermills',
          'Greenhouses',
          'Coops, Pens & Pigsties',
          'Farm Outbuildings & Lean-tos',
        ]),
        t('Industrial Buildings', [
          'Factories & Mills',
          'Warehouses & Depots',
          'Workshops & Garages',
          'Foundries & Furnaces',
          'Refineries',
          'Power Stations',
          'Pumping Stations',
          'Mine Heads & Pit Buildings',
          'Kilns & Smokehouses',
        ]),
        t('Military Buildings', [
          'Barracks',
          'Command Posts & HQs',
          'Hangars & Aircraft Pens',
          'Guardhouses',
          'Magazines & Ammo Stores',
          'Mess Halls & Stores',
          { name: 'Nissen / Quonset Huts', synonyms: ['nissen hut', 'quonset hut'] },
          'Motor Pools',
        ]),
        t('Towers', [
          'Watchtowers',
          'Bell & Clock Towers',
          'Wizard Towers',
          'Water Towers',
          'Windmill Towers',
          'Minarets',
          'Lighthouse Towers',
        ]),
        t('Sci-fi Structures', [
          { name: 'Habs & Colony Prefabs', synonyms: ['hab', 'habitation block'] },
          'Domes & Bio-domes',
          'Research Stations & Labs',
          'Generators & Reactors',
          'Atmosphere Processors & Life Support',
          'Comms Spires',
          'Xenos / Alien Architecture',
        ]),
        t('Building Parts', [
          'Roofs',
          'Chimneys',
          'Doors & Windows',
          'Balconies & Porches',
          'Shop Signage',
          'Interior Floors & Fittings',
        ]),
      ]),
      t('Fortifications & Military Works', [
        t('Trenches & Earthworks', [
          'Straight Sections',
          'Corners & Traverses',
          'Junctions & Crossings',
          'Firebays',
          'Dugouts & Shelters',
          { name: 'Foxholes & Gun Pits', synonyms: ['foxhole', 'fighting pit'] },
          'Berms & Embankments',
          'Sandbag Walls & Emplacements',
          'Gabions',
          'Revetments',
          'Duckboards',
        ]),
        t('Bunkers & Hardpoints', [
          'Concrete Bunkers',
          'Log Bunkers',
          'Pillboxes',
          'Casemates',
          'Observation Posts',
          'Air-raid Shelters',
        ]),
        t('Emplacements', [
          'Gun Emplacements',
          'AA Positions',
          'Mortar Pits',
          'Missile Silos & Launch Positions',
        ]),
        t('Castles & Medieval Defences', [
          'Keeps & Donjons',
          'Curtain Walls',
          'Gatehouses & Barbicans',
          'Wall Towers & Turrets',
          'Battlements & Hoardings',
          'Motte & Bailey',
          'Moats',
          'Drawbridges',
          'Hill Forts',
          'Siege Works',
        ]),
        t('Field Obstacles', [
          'Barbed & Razor Wire',
          { name: "Tank Traps & Dragon's Teeth", synonyms: ['dragons teeth'] },
          'Hedgehogs',
          'Chevaux de Frise',
          'Stakes & Palisade Lines',
          'Minefield Markers',
          'Roadblocks & Checkpoints',
          'Barricades',
        ]),
        t('Compound Defences', [
          'Compound Walls',
          'Hesco-style Barriers',
          'Blast Walls',
          'Guard Towers',
          'Fortified Gates',
        ]),
        t('Sci-fi Defences', [
          'Shield Generators',
          'Energy Barricades',
          'Turret Mounts & Auto-defences',
          'Void / Atmo Bastions',
        ]),
      ]),
      t('Walls, Fences & Boundaries', [
        t('Stone & Masonry', [
          'Drystone Walls',
          'Mortared Stone',
          'Brick Walls',
          'Rendered / Plastered Walls',
        ]),
        t('Hedges & Living Boundaries', [
          { name: 'Hedgerows', synonyms: ['hedge'] },
          { name: 'Bocage Banks', synonyms: ['bocage', 'hedgerow'] },
          'Formal Hedges & Topiary',
        ]),
        t('Timber', ['Post & Rail', 'Picket Fences', 'Wattle Fencing', 'Palisade Fencing']),
        t('Wire & Metal', [
          'Chain-link',
          'Barbed-wire Fencing',
          'Iron Railings',
          'Corrugated Sheeting',
        ]),
        t('Concrete & Urban', ['Jersey Barriers', 'Precast Panel Walls', 'Sound Walls']),
        t('Gates & Openings', ['Field Gates', 'Stiles', 'Archways', 'Cattle Grids']),
        t('Sci-fi Barriers', ['Energy Fences', 'Holo-barriers', 'Force-field Pylons']),
      ]),
      t('Natural Terrain', [
        t('Hills & Elevation', [
          'Gentle Hills',
          'Steep Hills',
          'Ridges',
          'Plateaus & Mesas',
          'Escarpments',
          'Valleys & Defiles',
        ]),
        t('Rock', [
          'Boulders',
          'Outcrops',
          'Cliffs & Crags',
          'Rock Spires & Pillars',
          'Scree Slopes',
        ]),
        t('Trees & Forests', [
          'Deciduous',
          'Conifer',
          'Palms',
          'Jungle Canopy',
          'Dead & Blasted Trees',
          'Orchards',
          'Giant / Fantasy Trees',
          'Alien Flora',
          'Fungal Forests',
        ]),
        t('Vegetation', [
          'Bushes & Shrubs',
          'Undergrowth & Scrub',
          'Crops & Field Sections',
          'Tall Grass & Reeds',
          'Cacti & Succulents',
          'Vines & Creepers',
        ]),
        t('Water Features', [
          'Rivers & Streams',
          'Ponds & Lakes',
          'Waterfalls',
          'Springs & Pools',
          'Swamps, Marshes & Bogs',
          'Ice & Frozen Water',
          'Geysers',
        ]),
        t('Ground Features', [
          'Craters',
          'Dunes',
          'Ditches & Gullies',
          'Sinkholes',
          'Lava Flows & Volcanic Vents',
          'Crystal Formations',
          'Tar Pits',
        ]),
        t('Caves & Underground', [
          'Cave Mouths',
          'Caverns',
          'Stalagmites & Columns',
          'Natural Tunnels',
        ]),
      ]),
      t('Roads, Paths & Rail', [
        t('Roads', [
          'Dirt Roads & Tracks',
          'Cobbled Streets',
          'Paved / Tarmac Roads',
          'Highways',
          'Junctions & Crossroads',
          'Cul-de-sacs & Squares',
        ]),
        t('Paths', ['Footpaths & Trails', 'Boardwalks', 'Stepping Paths', 'Garden Paths']),
        t('Rail', [
          'Track Sections',
          'Points & Junctions',
          'Level Crossings',
          'Buffers & Stops',
          'Platforms & Halts',
          'Signals & Signal Boxes',
          'Engine Sheds',
        ]),
        t('Airfields', ['Runways', 'Taxiways', 'Helipads', 'Landing Strips']),
        t('Street Detail', [
          'Pavements & Kerbs',
          'Road Markings',
          'Manholes & Drains',
          'Pedestrian Crossings',
        ]),
      ]),
      t('Bridges & Crossings', [
        'Stone & Arch Bridges',
        'Timber Bridges',
        'Rope & Suspension Bridges',
        'Girder & Metal Bridges',
        'Pontoon Bridges',
        'Railway Bridges',
        'Viaducts & Aqueducts',
        'Fords & Stepping Stones',
        'Culverts',
        'Footbridges',
      ]),
      t('Infrastructure & Utilities', [
        t('Power', [
          'Pylons',
          'Poles & Lines',
          'Transformers & Substations',
          'Generators',
          'Solar Arrays',
          'Wind Turbines',
        ]),
        t('Comms', [
          'Telegraph Poles',
          'Antenna Masts',
          'Satellite Dishes',
          'Radar Arrays',
          'Relay Stations',
        ]),
        t('Water & Fuel', [
          'Water Towers',
          'Storage Tanks',
          'Pipelines',
          'Pumps & Wellheads',
          'Fountains',
          'Fuel Dumps',
        ]),
        t('Urban Utilities', [
          'Street Lights',
          'Traffic Signals',
          'Road Signage',
          'Bus Stops',
          'Hydrants',
          'Bins & Recycling',
          'Sewer Entrances',
        ]),
        t('Sci-fi Infrastructure', [
          'Landing Pads',
          'Monorails & Mag-lines',
          'Power Conduits',
          'Teleport Pads',
          'Vox / Relay Towers',
        ]),
      ]),
      t('Maritime & Waterfront', [
        'Docks, Quays & Wharves',
        'Jetties & Piers',
        'Harbours & Marinas',
        'Slipways & Boathouses',
        'Lighthouses',
        'Fishing Huts & Shacks',
        'Canal Locks',
        'Beach Defences & Sea Walls',
        'Boats & Small Craft',
        'Ships',
        'Buoys & Moorings',
        'Nets, Pots & Tackle',
      ]),
      t('Scatter & Clutter', [
        t('Storage & Cargo', [
          'Crates',
          'Barrels',
          'Sacks',
          'Chests',
          'Pallets',
          'Shipping Containers',
          'Ammo Boxes',
          'Fuel Drums & Jerry Cans',
        ]),
        t('Camp & Field', [
          'Tents & Bivouacs',
          'Campfires',
          'Bedrolls & Kit',
          'Cooking Gear',
          'Supply Dumps',
        ]),
        t('Urban Clutter', [
          'Benches',
          'Market Goods',
          'Rubbish & Debris Bins',
          'Planters',
          'Newspaper Stands',
          'Scaffolding',
        ]),
        t('Rural Clutter', [
          'Hay Bales',
          'Troughs',
          'Woodpiles & Logs',
          'Beehives',
          'Water Butts',
        ]),
        t('Rubble & Debris', [
          'Rubble Piles',
          'Collapsed Masonry',
          'Twisted Girders',
          'Debris Fields',
          'Burnt Remains',
        ]),
        t('Interior Furniture', [
          'Tables & Chairs',
          'Beds & Bunks',
          'Shelving & Bookcases',
          'Counters & Bars',
          'Forges & Anvils',
          'Workbenches',
          'Machinery & Consoles',
        ]),
        t('Fantasy Scatter', [
          'Treasure & Loot Piles',
          'Altars',
          'Statues & Idols',
          'Braziers',
          'Cages & Gibbets',
          'Runestones',
          'Summoning Circles',
          'Gravestones',
        ]),
        t('Sci-fi Scatter', [
          'Cargo Pods',
          'Terminals & Consoles',
          'Holo-projectors',
          'Pipework & Vents',
          'Toxic Drums',
          'Servo-crates',
        ]),
        t('Remains', ['Bones & Skulls', 'Casualties', 'Carcasses', 'Skeletons & Remains']),
      ]),
      t('Vehicles & Wrecks', [
        t('Wrecks', [
          'Tank Wrecks',
          'Car & Truck Wrecks',
          'Crashed Aircraft',
          'Crashed Spacecraft',
          'Train Wrecks',
        ]),
        t('Derelicts', ['Rusted Hulks', 'Overgrown Vehicles', 'Stripped Chassis']),
        t('Static / Parked', [
          'Civilian Cars',
          'Trucks & Vans',
          'Buses & Coaches',
          'Farm Machinery',
          'Construction Plant',
        ]),
        t('Horse-drawn', ['Carts', 'Wagons', 'Carriages', 'Chariots']),
        t('Objective Vehicles', [
          'Fuel Trucks',
          'Staff Cars',
          'Supply Lorries',
          "Downed Pilots' Craft",
        ]),
      ]),
      t('Dungeons & Interiors', [
        'Floor Tiles',
        'Wall Sections',
        'Doors & Portals',
        'Stairs, Ladders & Ramps',
        'Pillars & Columns',
        'Traps & Mechanisms',
        'Crypts & Tombs',
        'Sewers',
        'Mines & Tunnels',
        'Prison Cells',
        'Sci-fi Corridors & Bulkheads',
        'Airlocks',
        'Caverns',
      ]),
      t('Boards, Tiles & Bases', [
        'Flat Table Tiles',
        'Height & Elevation Tiles',
        'Slope & Transition Tiles',
        'Feature Tiles (River, Road, Crater, Trench)',
        'Table Edging & Trim',
        'Display Bases & Plinths',
        'Zone / Sector Tiles',
      ]),
      t('Gaming Aids & Markers', [
        'Objective Markers',
        'Tokens & Counters',
        'Templates & Measures',
        'Status & Wound Markers',
        'Turn Trackers',
        'Dice Towers & Trays',
        'Movement Trays',
        'Deployment Markers',
        t('Battle Effects', [
          'Smoke Plumes',
          'Fire & Flame Markers',
          'Explosions',
          'Spell & Psychic Effects',
          'Energy Blasts',
          'Water Splashes',
        ]),
      ]),
    ],
  },

  // ==========================================================================
  // 2 · SETTING & ERA — when / what world it belongs to
  // ==========================================================================
  {
    slug: 'setting-era',
    name: 'Setting & Era',
    description: 'When and in what world the piece belongs. A model can span several.',
    selectionUi: 'tree',
    required: true,
    maxTerms: 4,
    terms: [
      t('Historical', [
        t('Ancient', [
          'Bronze Age',
          'Classical Greek',
          'Roman',
          'Celtic & Iron Age',
          'Ancient Egyptian',
          'Biblical & Near East',
        ]),
        t('Dark Ages', ['Viking', 'Anglo-Saxon', 'Early Medieval']),
        t('Medieval', [
          'High Medieval',
          'Late Medieval',
          'Crusades',
          'Feudal Japan (Sengoku)',
          'Medieval Islamic World',
        ]),
        t('Renaissance & Pike/Shot', [
          'Italian Wars',
          "Thirty Years' War",
          'English Civil War',
          'Golden Age of Piracy / Age of Sail',
        ]),
        t('18th Century', [
          "Seven Years' War",
          'American War of Independence',
          'Jacobite Risings',
        ]),
        'Napoleonic',
        t('19th Century', [
          'American Civil War',
          'Victorian',
          'Colonial (Zulu, Sudan, NW Frontier)',
          'Old West',
          'Franco-Prussian',
        ]),
        t('World War One', ['Western Front', 'Eastern Front', 'Gallipoli & Middle East']),
        t('Interwar', ['Spanish Civil War', 'Back of Beyond']),
        t('World War Two', [
          'Western Europe',
          'Eastern Front',
          'North Africa',
          'Italy',
          'Pacific',
          'Home Front & Blitz',
        ]),
        t('Cold War', ['1950s–80s Conventional', 'Vietnam', 'Korea']),
        t('Modern', ['1990s–present', 'Middle East Operations', 'Urban Ops']),
        t('Near Future', ['Ultramodern Speculative']),
      ]),
      t('Fantasy', [
        'High Fantasy',
        'Dark & Grimdark Fantasy',
        'Fairy-tale & Whimsical',
        'Eastern Fantasy',
        'Norse & Mythic',
        'Gothic Horror',
        'Underdark & Subterranean',
        'Pirate Fantasy',
      ]),
      t('Science Fiction', [
        'Grimdark / Gothic Sci-fi',
        'Hard Sci-fi & Near Future',
        'Space Opera',
        'Cyberpunk',
        'Colony & Frontier',
        'Alien Worlds',
        { name: 'Derelict & Void', synonyms: ['space hulk', 'space station'] },
      ]),
      t('Post-Apocalyptic', [
        'Nuclear Wasteland',
        'Zombie Apocalypse',
        'Overgrown & Reclaimed',
        { name: 'Vehicular Mayhem', synonyms: ['road war'] },
      ]),
      t('Other Genres', [
        'Steampunk',
        { name: 'Weird War', synonyms: ['occult war'] },
        { name: 'Weird West', synonyms: ['wild west gothic'] },
        'Lovecraftian & Eldritch',
        'Horror (Generic)',
      ]),
    ],
  },

  // ==========================================================================
  // 3 · SCALE — flat, with a ratio attribute per validated scale
  // ==========================================================================
  {
    slug: 'scale',
    name: 'Scale',
    description: 'Which miniatures the model suits.',
    selectionUi: 'chips',
    required: true,
    maxTerms: 4,
    terms: [
      scale('2mm', '1:600'),
      scale('3mm', '1:500'),
      scale('6mm', '1:285–1:300'),
      scale('10mm', '1:160'),
      scale('12mm', '1:144'),
      scale('15mm', '1:100'),
      scale('20mm', '1:72–1:76'),
      scale('25mm', '1:64'),
      scale('28mm', '1:56'),
      scale('32mm Heroic', '1:48–1:50'),
      scale('35mm+'),
      scale('54mm', '1:32'),
      scale('Display Scale'),
      scale('Scale-agnostic'),
    ],
  },

  // ==========================================================================
  // 4 · ENVIRONMENT — biome / landscape it fits
  // ==========================================================================
  {
    slug: 'environment',
    name: 'Environment',
    description: 'The biome or landscape the piece suits.',
    selectionUi: 'chips',
    terms: [
      'Temperate & European',
      'Mediterranean',
      'Desert & Arid',
      'Arctic, Tundra & Snow',
      'Jungle & Tropical',
      'Swamp & Wetland',
      'Coastal & Island',
      'Mountain & Alpine',
      'Volcanic & Ashland',
      'Badlands & Canyon',
      'Underground & Cavern',
      'Urban',
      'Suburban',
      'Rural & Farmland',
      'Industrial Zone',
      'Wasteland',
      'Alien & Xenos',
      'Orbital & Void',
      'Underdark',
    ].map((n) => ({ name: n })),
  },

  // ==========================================================================
  // 5 · CONDITION — replaces every would-be "Ruins" branch in the type tree
  // ==========================================================================
  {
    slug: 'condition',
    name: 'Condition',
    description: 'Intact → rubble spectrum. Cross-cuts every terrain type.',
    selectionUi: 'chips',
    terms: [
      'Pristine & New-build',
      'Weathered & Lived-in',
      'Damaged',
      'Ruined',
      'Destroyed & Rubble',
      'Burnt-out',
      'Derelict & Abandoned',
      'Overgrown & Reclaimed',
      'Under Construction',
      'Flooded',
      'Frozen-over',
    ].map((n) => ({ name: n })),
  },

  // ==========================================================================
  // 6 · GAMEPLAY ROLE — what it does on the table
  // ==========================================================================
  {
    slug: 'gameplay-role',
    name: 'Gameplay Role',
    description: 'How the piece behaves in play.',
    selectionUi: 'chips',
    terms: [
      { name: 'LOS Blocker', synonyms: ['line of sight'] },
      'Heavy Cover',
      'Light Cover',
      'Area Terrain',
      'Linear Obstacle',
      'Elevation & Vantage',
      'Difficult Ground',
      'Impassable',
      'Objective Feature',
      'Deployment Feature',
      'Interactive (Openable, Enterable)',
      'Board & Mat',
    ].map((c) => (typeof c === 'string' ? { name: c } : c)),
  },

  // ==========================================================================
  // 7 · FEATURES & COMPATIBILITY — grouped flags (platform badges live here)
  // ==========================================================================
  {
    slug: 'features',
    name: 'Features & Compatibility',
    description: 'Modularity, interiors, peg systems and planner support.',
    selectionUi: 'grouped',
    terms: [
      t('Construction', [
        'Modular',
        'One-piece',
        'Multi-part Kit',
        'Stackable',
        'Openable / Removable Roofs',
        'Playable Interior',
        'Multi-storey with Removable Floors',
        'Magnet-ready',
        'LED / Lighting-ready',
        'Hollowed',
      ]),
      t('System Compatibility', [
        { name: 'Planner-ready', synonyms: ['planner', 'placeable'] },
        'OpenLOCK',
        'DragonLock',
        'Magnetic Basing Standard',
      ]),
      t('Extras Included', [
        'Painting Guide',
        'Assembly Guide',
        'Lore / Fluff Sheet',
        'Alternate Parts',
      ]),
    ],
  },

  // ==========================================================================
  // 8 · PRINT & FILES — grouped; print process is required at upload
  // ==========================================================================
  {
    slug: 'print-files',
    name: 'Print & Files',
    description: 'FDM/resin, supports, formats and bed size.',
    selectionUi: 'grouped',
    required: true,
    terms: [
      t('Process', ['FDM-optimised', 'Resin-optimised', 'FDM & Resin']),
      t('Supports', ['No Supports Needed', 'Pre-supported (Resin)', 'Supports Required']),
      t('Bed Size Class', [
        'Fits 120mm (Mini Resin)',
        'Fits 180mm',
        'Fits 220mm',
        'Fits 256mm',
        'Fits 300mm',
        '350mm+ / Large Format',
      ]),
      t('Files', [
        'STL',
        '3MF',
        'Pre-sliced (Lychee)',
        'Pre-sliced (Chitubox)',
        'Cut & Keyed for Small Beds',
      ]),
      t('Assurance', [
        'Test-printed by Artist',
        'Community Makes Verified',
        'Tolerance-tested (Pegs/Joints)',
      ]),
    ],
  },

  // ==========================================================================
  // 9 · LICENCE — usage rights
  // ==========================================================================
  {
    slug: 'licence',
    name: 'Licence',
    description: 'Usage rights granted with the file.',
    selectionUi: 'flat',
    required: true,
    terms: [
      'Personal Use',
      'Merchant Licence (Physical Sales)',
      'Commercial Display',
      'Free',
      'Creative Commons (CC0 / CC-BY)',
      'Included in Subscription / Welcome Pack',
    ].map((n) => ({ name: n })),
  },

  // ==========================================================================
  // 10 · CAN BE USED WITH — curated game-system compatibility (descriptive only)
  //   Slug stays `designed-for` (immutable identifier); only the display name +
  //   copy changed to the plainer, more clearly nominative "Can be used with".
  // ==========================================================================
  {
    slug: 'designed-for',
    name: 'Can be used with',
    description:
      'Game systems this terrain can be used with — a compatibility guide only. All names are the ' +
      'trademarks of their respective owners; listing one does not imply any affiliation or endorsement.',
    selectionUi: 'grouped',
    terms: [
      t('Sci-fi Skirmish / Battle', [
        'Warhammer 40,000-scale',
        'Kill Team',
        'Necromunda-style Underhive',
        'Horus Heresy',
        'Battletech (6mm)',
        'Epic Scale',
        'Infinity',
        'Star Wars Legion',
        'Stargrave',
        'Five Parsecs',
      ]),
      t('Fantasy', [
        'Age of Sigmar-scale',
        'Kings of War',
        'Frostgrave',
        'Mordheim-style',
        'Warcry',
        'Saga: Age of Magic',
        'D&D / Pathfinder / TTRPG 28mm',
      ]),
      t('Historical', [
        'Bolt Action',
        'Chain of Command',
        'Flames of War (15mm)',
        'Team Yankee',
        'SAGA',
        'Hail Caesar',
        'Black Powder',
        'Sharp Practice',
        'What a Tanker',
      ]),
      t('Modern / Other', [
        'Gaslands',
        'Zona Alfa',
        'Spectre Operations',
        'Fallout: Wasteland Warfare',
        'The Walking Dead',
        'Marvel Crisis Protocol',
        'Malifaux',
        'Trench Crusade',
      ]),
    ],
  },
]

/** Derive an immutable, URL-safe slug from a display name. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (café → cafe)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[/,]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
