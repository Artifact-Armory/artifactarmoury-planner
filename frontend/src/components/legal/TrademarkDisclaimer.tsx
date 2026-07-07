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

const TrademarkDisclaimer: React.FC<{ className?: string }> = ({ className }) => (
  <p className={className ?? 'text-xs text-gray-500'}>{TRADEMARK_DISCLAIMER}</p>
)

export default TrademarkDisclaimer
