// src/scene/loadManager.ts
//
// One shared THREE.LoadingManager for every network asset the planner pulls in
// (GLB catalogue models + table-surface PBR textures). It drives the loading
// overlay so the user can't start building until the initial scene is ready —
// which is what removes the "start then everything janks in" feeling.
//
// Both loaders.ts (GLTF/DRACO) and tableMaterials.ts (textures) construct their
// loaders with this manager, so all progress flows through one place.

import * as THREE from 'three'

export const assetLoadingManager = new THREE.LoadingManager()

export interface LoadProgress {
  /** True while at least one asset is still in flight. */
  active: boolean
  /** Cumulative items finished this session. */
  loaded: number
  /** Cumulative items queued this session. */
  total: number
}

let state: LoadProgress = { active: false, loaded: 0, total: 0 }
const listeners = new Set<(p: LoadProgress) => void>()

function emit() {
  for (const fn of listeners) fn(state)
}

assetLoadingManager.onStart = (_url, loaded, total) => {
  state = { active: true, loaded, total }
  emit()
}
assetLoadingManager.onProgress = (_url, loaded, total) => {
  state = { active: true, loaded, total }
  emit()
}
assetLoadingManager.onLoad = () => {
  state = { ...state, active: false }
  emit()
}
assetLoadingManager.onError = () => {
  // A failed asset shouldn't wedge the loader; onLoad still fires when the
  // queue drains. Individual loaders log their own warnings.
}

/** Subscribe to load progress. Fires immediately with the current state. */
export function subscribeLoading(fn: (p: LoadProgress) => void): () => void {
  listeners.add(fn)
  fn(state)
  return () => {
    listeners.delete(fn)
  }
}

export function getLoadProgress(): LoadProgress {
  return state
}
