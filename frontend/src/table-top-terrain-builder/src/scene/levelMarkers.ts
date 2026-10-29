// src/scene/levelMarkers.ts — level markers in the 3D view: a translucent blue
// plane across the table at the height under the cursor while the marker tool is
// on, and for each placed marker a blue outline round the table at its height
// with its floor number floating off the front-right corner.
import * as THREE from 'three'
import type { Table } from '@state/store'

const BLUE = 0x3b82f6
const OVERHANG = 0.02 // the glow and outlines stick out past the table edge a little

function labelSprite(text: string, round: boolean): THREE.Sprite {
  const h = 64
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  ctx.font = 'bold 36px sans-serif'
  const w = round ? h : Math.ceil(ctx.measureText(text).width) + 32
  c.width = w; c.height = h
  ctx.fillStyle = '#2563eb'
  ctx.beginPath()
  if (round) ctx.arc(w / 2, h / 2, h / 2 - 2, 0, Math.PI * 2)
  else ctx.roundRect(2, 2, w - 4, h - 4, 14)
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 36px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2 + 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  sprite.renderOrder = 20
  const size = 0.035 // metres tall
  sprite.scale.set((size * w) / h, size, 1)
  return sprite
}

function outline(table: Table, y: number, opacity: number): THREE.LineLoop {
  const hw = table.width / 2 + OVERHANG, hh = table.height / 2 + OVERHANG
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-hw, y, -hh), new THREE.Vector3(hw, y, -hh),
    new THREE.Vector3(hw, y, hh), new THREE.Vector3(-hw, y, hh),
  ])
  const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity, depthTest: false }))
  line.renderOrder = 19
  return line
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh
    m.geometry?.dispose()
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
    for (const mat of mats) {
      ;(mat as THREE.SpriteMaterial).map?.dispose()
      mat.dispose()
    }
  })
}

export class LevelMarkerView {
  readonly group = new THREE.Group()
  private placed = new THREE.Group()
  private preview = new THREE.Group()
  private previewKey = ''

  constructor() {
    this.group.add(this.placed, this.preview)
  }

  /** Redraw the placed markers. */
  sync(markers: number[], table: Table) {
    disposeTree(this.placed)
    this.placed.clear()
    markers.forEach((y, i) => {
      this.placed.add(outline(table, y, 0.9))
      const label = labelSprite(String(i + 1), true)
      label.position.set(table.width / 2 + OVERHANG + 0.03, y, table.height / 2 + OVERHANG)
      this.placed.add(label)
    })
  }

  /** Show the glow plane at height y with a label, or hide it (null). */
  setPreview(y: number | null, table: Table, text = '') {
    if (y == null) {
      this.preview.visible = false
      return
    }
    const key = `${table.width}x${table.height}|${text}`
    if (key !== this.previewKey) {
      disposeTree(this.preview)
      this.preview.clear()
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(table.width + 2 * OVERHANG, table.height + 2 * OVERHANG),
        new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
      )
      plane.rotation.x = -Math.PI / 2
      plane.renderOrder = 18
      this.preview.add(plane, outline(table, 0, 1))
      if (text) {
        const label = labelSprite(text, false)
        label.position.set(table.width / 2 + OVERHANG + 0.06, 0, table.height / 2 + OVERHANG)
        this.preview.add(label)
      }
      this.previewKey = key
    }
    this.preview.position.y = y
    this.preview.visible = true
  }

  dispose() {
    disposeTree(this.group)
    this.group.clear()
  }
}
