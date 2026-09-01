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
    title: 'Your sales at a glance',
    body: 'Sales Overview shows your earnings, completed sales, views, conversion and top models — plus the full sales ledger — over any date range. Come back here to see what’s selling.',
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
    target: 'nav-releases',
    title: 'Releases',
    body: 'Line up a batch of models to launch together on a date — build anticipation and drop them in one go.',
  },
  {
    target: 'nav-showcases',
    title: 'Showcases',
    body: 'Build a full table of your models in the 3D Planner and publish it. Buyers open the showcase and add the whole set — or individual pieces — to their basket.',
  },
  {
    target: 'nav-settings',
    title: 'Your public artist profile',
    body: 'Set your display name, avatar and bio here — it’s the page buyers see when they browse your work, so keep it filled in.',
  },
  {
    target: 'help-button',
    title: 'Help is always here',
    body: 'Stuck on any page? Click Help for a page-specific refresher, or replay this tour whenever you like.',
  },
  {
    title: 'Next up: the Planner 🧱',
    body: 'The full-screen Planner lets you (and your buyers) lay out a whole table in 3D. Open it from Showcases or any model page — it has its own built-in walkthrough and keyboard shortcuts (press ? inside it).',
  },
]

// Shown the first time an artist opens the 3D Planner — walks them through
// turning a layout into a published showcase. Targets `data-tour` values on the
// planner UI (see table-top-terrain-builder App).
export const plannerShowcaseSteps: TourStep[] = [
  {
    title: 'Build a showcase 🧱',
    body: 'A showcase is a table you build here from your own models, then publish so buyers can add the whole set — or single pieces — to their basket. Here’s the quick version.',
  },
  {
    target: 'planner-tabs',
    title: 'Find your models',
    body: 'Switch to “My items” to see the models you’ve uploaded. The Catalogue tab has everything on the marketplace if you want to mix in other pieces.',
  },
  {
    target: 'planner-palette',
    title: 'Place pieces',
    body: 'Click a model to pick it up, then click the table to drop it. Scroll to zoom, right click and drag to look around, and press R to rotate.',
  },
  {
    target: 'planner-save',
    title: 'Save it',
    body: 'Hit Save (or Ctrl+S) to store this layout as one of your tables. You’ll be asked to name it.',
  },
  {
    title: 'Then publish it',
    body: 'Back in your dashboard, open Showcases, and hit Publish on the table. Buyers can then open its public page and add your models to their basket. Press ? anytime for the full list of controls.',
  },
]

// Shown the first time a buyer (non-artist / guest) opens the 3D Planner — walks
// them through laying out a table and pushing it into their basket. Targets the
// same `data-tour` values on the planner UI (see table-top-terrain-builder App).
export const plannerBuyerSteps: TourStep[] = [
  {
    title: 'Welcome to the Planner 🧱',
    body: 'Lay out a whole tabletop in 3D, then send the models you’ve used straight to your basket. Here’s a 30-second tour — skip anytime, or replay it with the Help button.',
  },
  {
    target: 'planner-palette',
    title: 'Pick your terrain',
    body: 'Browse the marketplace here. Click a model to pick it up, then click the table to drop it. Use the search box to find something fast.',
  },
  {
    target: 'planner-tabs',
    title: 'Catalogue vs. My items',
    body: '“Catalogue” is everything on the marketplace. “My items” gathers the models you already own or have in your basket, so your go-to pieces are one click away.',
  },
  {
    title: 'Moving around',
    body: 'Scroll to zoom, right click and drag to orbit the camera, and press R to rotate a selected piece. Drop pieces on top of each other and they stack automatically. Press ? anytime for the full list of controls.',
  },
  {
    target: 'planner-bom',
    title: 'Your build & basket',
    body: 'The “Table” tab lists every unique model you’ve placed, with its price — hit “Add all to basket” to buy the whole set (you pay for each STL once and can print it as many times as you like). Placing a model doesn’t add it to your basket by itself — switch to the “Basket” tab anytime to see exactly what you’re about to buy.',
  },
  {
    target: 'planner-save',
    title: 'Save your table',
    body: 'Save (or Ctrl+S) keeps this layout so you can reopen and edit it later from My Tables. You’ll need to be signed in to save.',
  },
]
