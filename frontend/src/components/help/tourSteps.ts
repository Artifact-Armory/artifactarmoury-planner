// Steps for the first-time artist walkthrough. `target` is a `data-tour` value
// on a sidebar/header element; a step with no target renders centred.
export interface TourStep {
  target?: string
  title: string
  body: string
}

export const artistTourSteps: TourStep[] = [
  {
    title: 'Welcome to your studio 👋',
    body: 'A quick 30-second tour of where everything lives. You can skip anytime, and replay it later from the Help button.',
  },
  {
    target: 'nav-overview',
    title: 'Your numbers at a glance',
    body: 'The Overview shows your earnings, sales, views and conversion. Come back here to see what’s selling.',
  },
  {
    target: 'nav-upload',
    title: 'Upload a model',
    body: 'Add an STL here. We generate the 3D preview and print estimate for you, and watermark every download to protect your work.',
  },
  {
    target: 'nav-models',
    title: 'Manage your models',
    body: 'Publish, unpublish, edit or delete your models — including drafts that are still processing.',
  },
  {
    target: 'nav-bundles',
    title: 'Bundle & save',
    body: 'Group several of your own models under one name and price to sell them together.',
  },
  {
    target: 'nav-sales',
    title: 'Sales & analytics',
    body: 'Track earnings, top models, planner placements and the searches buyers are running — over any date range.',
  },
  {
    target: 'help-button',
    title: 'Help is always here',
    body: 'Stuck on any page? Click Help for a page-specific refresher, or replay this tour whenever you like.',
  },
  {
    title: 'Next up: the Planner 🧱',
    body: 'The full-screen Planner lets you (and your buyers) lay out a whole table in 3D. Open it from any model page or the top menu — it has its own built-in guide and keyboard shortcuts (press ? inside it).',
  },
]
