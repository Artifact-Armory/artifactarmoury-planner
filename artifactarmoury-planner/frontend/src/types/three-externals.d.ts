declare module 'three/examples/jsm/controls/OrbitControls.js' {
  import { Camera, EventDispatcher, MOUSE, Object3D, Renderer, Vector3 } from 'three'

  export class OrbitControls extends EventDispatcher {
    constructor(object: Camera, domElement?: HTMLElement)
    object: Camera
    domElement: HTMLElement
    enabled: boolean
    target: Vector3
    minDistance: number
    maxDistance: number
    minZoom: number
    maxZoom: number
    minPolarAngle: number
    maxPolarAngle: number
    minAzimuthAngle: number
    maxAzimuthAngle: number
    enableDamping: boolean
    dampingFactor: number
    enableZoom: boolean
    zoomSpeed: number
    enableRotate: boolean
    rotateSpeed: number
    enablePan: boolean
    panSpeed: number
    screenSpacePanning: boolean
    keyPanSpeed: number
    autoRotate: boolean
    autoRotateSpeed: number
    enableKeys: boolean
    keys: { LEFT: string; UP: string; RIGHT: string; BOTTOM: string }
    mouseButtons: { LEFT: MOUSE; MIDDLE: MOUSE; RIGHT: MOUSE }
    saveState(): void
    reset(): void
    update(): boolean
    dispose(): void
    listenToKeyEvents(domElement: HTMLElement): void
    stopListenToKeyEvents(): void
  }
}

declare module 'three/examples/jsm/controls/TransformControls.js' {
  import { Camera, EventDispatcher, Object3D } from 'three'

  export type TransformMode = 'translate' | 'rotate' | 'scale'

  export class TransformControls extends EventDispatcher {
    constructor(camera: Camera, domElement?: HTMLElement)
    object?: Object3D
    enabled: boolean
    axis?: string
    mode: TransformMode
    translationSnap?: number | null
    rotationSnap?: number | null
    space: 'world' | 'local'
    size: number
    showX: boolean
    showY: boolean
    showZ: boolean
    dragging: boolean
    setMode(mode: TransformMode): void
    setTranslationSnap(snap?: number): void
    setRotationSnap(snap?: number): void
    setSize(size: number): void
    setSpace(space: 'world' | 'local'): void
    attach(object: Object3D): void
    detach(): void
    dispose(): void
    reset(): void
  }
}

declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  import { LoadingManager, Object3D } from 'three'

  export interface GLTF {
    scene: Object3D
  }

  export class GLTFLoader {
    constructor(manager?: LoadingManager)
    load(
      url: string,
      onLoad: (gltf: GLTF) => void,
      onProgress?: (event: ProgressEvent<EventTarget>) => void,
      onError?: (event: unknown) => void,
    ): void
  }
}
