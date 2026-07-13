import React from 'react'

export interface HelpSection {
  heading: string
  body: React.ReactNode
}

export interface HelpEntry {
  title: string
  intro?: React.ReactNode
  sections: HelpSection[]
  /** Show the "Replay walkthrough" button (artist dashboard pages only). */
  showTour?: boolean
}

// Ordered most-specific → least-specific; the first matching rule wins.
const RULES: Array<{ test: (path: string) => boolean; entry: HelpEntry }> = [
  {
    test: (p) => p === '/artist/models/new',
    entry: {
      title: 'Uploading a model',
      intro: 'Add an STL and we do the rest — 3D preview, print estimate, and a per-buyer watermark on every download.',
      sections: [
        { heading: 'Classification', body: 'The four starred dropdowns (type, era, scale, condition) are required — they decide which searches your model appears in. Tick everything that applies; use the search box in each list to find a term fast.' },
        { heading: 'Extra parts', body: 'If your piece comes as several STLs (e.g. separate floors), add them as extra parts. Buyers pay once, download all parts as a ZIP, and can place each part in the planner.' },
        { heading: 'Thumbnail', body: 'A preview image is required — it’s what buyers see in the marketplace. New uploads start as a draft; publish them from My Models when you’re ready.' },
      ],
    },
  },
  {
    test: (p) => p.startsWith('/artist/models'),
    entry: {
      title: 'My Models',
      intro: 'Everything you’ve uploaded, including drafts and still-processing files.',
      sections: [
        { heading: 'Publish / Unpublish', body: 'Publish is enabled once a model is processed and has a thumbnail plus a description of 20+ characters. Unpublish to hide it from buyers without deleting it.' },
        { heading: 'Edit', body: 'Change the name, description, tags and price anytime. Save & publish does both in one step.' },
        { heading: 'Delete', body: 'Removes the model and its files. Buyers who already purchased it lose download access, but you can re-upload the same file later.' },
      ],
    },
  },
  {
    test: (p) => p.startsWith('/artist/bundles'),
    entry: {
      title: 'Bundles',
      intro: 'Group several of your own models under one name and one price.',
      sections: [
        { heading: 'Publishing a bundle', body: 'A bundle needs at least 2 of your models, a thumbnail, a description of 20+ characters, and a price above £0.' },
        { heading: 'How buyers get it', body: 'Buying a bundle grants a download of every model inside it — each still watermarked individually.' },
      ],
    },
  },
  {
    test: (p) => p.startsWith('/artist/sales') || p.startsWith('/artist/analytics'),
    entry: {
      title: 'Sales & analytics',
      intro: 'Use the data to decide what to make, and how to price, present and tag it.',
      sections: [
        { heading: 'Date range', body: 'Every tile compares the selected range against the previous one — the % chip shows the trend.' },
        { heading: 'Drill in', body: 'Click any tile to open a detailed breakdown: sales, product funnels, ratings and the searches buyers are running.' },
        { heading: 'Earnings', body: 'Your earnings figure is net of the 15% marketplace fee.' },
      ],
    },
  },
  {
    test: (p) => p.startsWith('/artist/releases'),
    entry: {
      title: 'Releases',
      intro: 'Group upcoming models into a dated launch so they drop together.',
      sections: [
        { heading: 'Why use a release', body: 'Line several models up behind one launch date to build anticipation and publish them all at once, rather than trickling them out.' },
        { heading: 'Before the date', body: 'Models attached to a release stay hidden from buyers until it goes live.' },
      ],
    },
  },
  {
    test: (p) => p.startsWith('/artist/showcases'),
    entry: {
      title: 'Showcases',
      intro: 'A showcase is a 3D table you build from your own models and publish for buyers.',
      sections: [
        { heading: 'Build one', body: 'Click “New showcase” to open the Planner, switch to the “My items” tab, and place your models on the table. Save (Ctrl+S) to store it.' },
        { heading: 'Publish', body: 'Hit Publish on a saved showcase so buyers can open its public page. From there they can add the whole set — or individual pieces — to their basket.' },
        { heading: 'Share', body: 'Use Copy link to share the public showcase anywhere. Only published showcases are visible to buyers.' },
      ],
      showTour: true,
    },
  },
  {
    test: (p) => p.startsWith('/artist/collaborations'),
    entry: {
      title: 'Collaborations',
      intro: 'Other artists need your consent to feature your models in their showcases.',
      sections: [
        { heading: 'Why you got a request', body: 'When an artist places one of your models on their showcase, we send you a request. They can’t publish that showcase until you accept.' },
        { heading: 'Accept all or some', body: 'Approve every model of yours on their table, or tick just the ones you’re happy for them to use. You can also decline.' },
        { heading: 'Your credit', body: 'Once you accept, you’re credited as a featured artist on that table wherever it’s browsed.' },
      ],
    },
  },
  {
    test: (p) => p.startsWith('/artist/settings'),
    entry: {
      title: 'Artist profile',
      sections: [
        { heading: 'Your public page', body: 'This is what buyers see on your artist profile — a display name, avatar and bio. Keep it filled in to build trust.' },
      ],
    },
  },
  {
    test: (p) => p === '/artist',
    entry: {
      title: 'Sales Overview',
      intro: 'Your studio’s home: earnings, sales and the data behind what to make next, all on one page.',
      sections: [
        { heading: 'Date range', body: 'Every tile compares the selected range against the previous one — the % chip shows the trend. Click a tile to drill into sales, product funnels, ratings or buyer searches.' },
        { heading: 'Sales ledger', body: 'The table below the tiles lists every completed sale — item, buyer, order and what you earned (net of the 15% marketplace fee).' },
        { heading: 'Upload models', body: 'Use “Upload New Model” to add an STL — we generate the preview and print estimate automatically.' },
      ],
      showTour: true,
    },
  },
  // --- User (non-artist) dashboard ---
  {
    test: (p) => p.startsWith('/dashboard/tables'),
    entry: {
      title: 'My Tables',
      sections: [
        { heading: 'Open & edit', body: 'Open any saved table to keep building it in the 3D Planner.' },
        { heading: 'Share', body: 'Share link makes a table public and copies a link — anyone who opens it gets their own editable copy.' },
      ],
    },
  },
  {
    test: (p) => p.startsWith('/dashboard/purchases') || p.startsWith('/dashboard/models'),
    entry: {
      title: 'Your purchases',
      sections: [
        { heading: 'Downloads', body: 'Every STL you’ve bought is here to download as many times as you like — you buy once and print any number.' },
        { heading: 'Watermarking', body: 'Downloads are invisibly watermarked to you, so please don’t share the files.' },
      ],
    },
  },
  {
    test: (p) => p.startsWith('/dashboard'),
    entry: {
      title: 'Your dashboard',
      sections: [
        { heading: 'Getting around', body: 'The sidebar links to your models, order history, wishlist, saved tables and profile.' },
        { heading: 'Build a table', body: 'Head to the 3D Planner to lay out terrain, then push the whole build into your cart.' },
      ],
    },
  },
]

const FALLBACK: HelpEntry = {
  title: 'Help',
  sections: [
    { heading: 'Getting around', body: 'Use the sidebar to move between sections. Look for the Help button on any page for a refresher.' },
  ],
}

export function getHelpForPath(pathname: string): HelpEntry {
  return RULES.find((r) => r.test(pathname))?.entry ?? FALLBACK
}
