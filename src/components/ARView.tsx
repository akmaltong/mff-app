/**
 * ARView — web AR using phone camera + AprilTag (36h11) detection.
 *
 * Phase 1 — Tag detection:
 *   Any detected tag gets a coloured 3D cube + floating label overlay.
 *
 * Phase 2 — Navmesh anchoring:
 *   Two specific tags (configurable) act as ground-truth anchors.
 *   When both are visible, the SM_MFF.glb navmesh is positioned in
 *   real-world scale by computing a 2D similarity transform (XZ plane).
 *
 * Detection:  js-aruco2  with APRILTAG_36h11 dictionary
 * Rendering:  vanilla Three.js (transparent canvas over video)
 * Pose:       custom homography decomposition (poseEstimation.ts)
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { useAppStore } from '../store/appStore'
import {
  estimateIntrinsics,
  computePose,
  computeNavmeshTransform,
  type TagCorner,
} from '../utils/poseEstimation'
import zoneData from '../../zone_coordinates.json'

// ─── Constants ───────────────────────────────────────────────────────────────

const TAG_SIZE_METERS = 0.19   // 19 cm printed tag
const DET_WIDTH = 640          // detection canvas (downscaled for speed)
const DET_HEIGHT = 480
const V_FOV_DEG = 70           // assumed vertical camera FOV

// Zone positions used for navmesh anchoring selection
const ZONES = (zoneData as any).zones as Array<{
  id: string
  display_name: string
  position: { x: number; y: number; z: number }
}>

// Default anchor configuration (zones that are far apart for good scale estimation)
const DEFAULT_ANCHOR_0 = { tagId: 0, zoneId: 'zone-1'  } // Аккредитация
const DEFAULT_ANCHOR_1 = { tagId: 1, zoneId: 'zone-12' } // Зал Пленарного Заседания

// ─── Types ───────────────────────────────────────────────────────────────────

interface DetectedMarker {
  id: number
  corners: TagCorner[]
  center: { x: number; y: number }
  pose?: ReturnType<typeof computePose>
}

interface LabelInfo {
  id: number
  screenX: number
  screenY: number
  distance: number
  label: string
  color: string
}

interface AnchorConfig {
  tagId: number
  zoneId: string
}

// Assign a deterministic colour to each tag ID
function tagColor(id: number): string {
  const colors = [
    '#00e5ff', '#69ff47', '#ff6d00', '#d500f9', '#ffea00',
    '#00e676', '#ff1744', '#2979ff', '#ff6d00', '#76ff03',
  ]
  return colors[id % colors.length]
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ARView() {
  const setArMode = useAppStore(state => state.setArMode)

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const videoRef      = useRef<HTMLVideoElement>(null)
  const detCanvasRef  = useRef<HTMLCanvasElement>(null)   // hidden, for pixel access
  const threeCanvasRef = useRef<HTMLCanvasElement>(null)  // Three.js output

  // ── Three.js internals ────────────────────────────────────────────────────
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef    = useRef<THREE.Scene | null>(null)
  const cameraRef   = useRef<THREE.PerspectiveCamera | null>(null)
  const tagMeshes   = useRef<Map<number, THREE.Group>>(new Map())
  const navmeshRef  = useRef<THREE.Group | null>(null)
  const navmeshLoadedRef = useRef(false)
  const rafRef      = useRef<number>(0)

  // ── Detection ─────────────────────────────────────────────────────────────
  const detectorRef       = useRef<any>(null)
  const detFrameCount     = useRef(0)
  const lastDetections    = useRef<DetectedMarker[]>([])
  const anchorPositions   = useRef<Map<number, [number, number, number]>>(new Map())

  // ── UI state ─────────────────────────────────────────────────────────────
  const [detectorStatus, setDetectorStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [phase, setPhase] = useState<1 | 2>(1)
  const [labels, setLabels] = useState<LabelInfo[]>([])
  const [anchor0, setAnchor0] = useState<AnchorConfig>(DEFAULT_ANCHOR_0)
  const [anchor1, setAnchor1] = useState<AnchorConfig>(DEFAULT_ANCHOR_1)
  const [anchorStatus, setAnchorStatus] = useState({ a0: false, a1: false })
  const [showConfig, setShowConfig] = useState(false)
  const [navmeshAnchored, setNavmeshAnchored] = useState(false)

  // ── Refs for values read inside the animation loop ─────────────────────
  const phaseRef   = useRef<1 | 2>(1)
  const anchor0Ref = useRef<AnchorConfig>(DEFAULT_ANCHOR_0)
  const anchor1Ref = useRef<AnchorConfig>(DEFAULT_ANCHOR_1)

  // Keep refs in sync with state
  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { anchor0Ref.current = anchor0 }, [anchor0])
  useEffect(() => { anchor1Ref.current = anchor1 }, [anchor1])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const getZone = (id: string) => ZONES.find(z => z.id === id)

  const getZoneNavXZ = (id: string): [number, number] => {
    const z = getZone(id)
    return z ? [z.position.x, z.position.z] : [0, 0]
  }

  /** Project a Three.js world point onto the screen. Returns null if behind camera. */
  const projectToScreen = useCallback(
    (pos: THREE.Vector3, W: number, H: number): { x: number; y: number } | null => {
      const cam = cameraRef.current
      if (!cam) return null
      const v = pos.clone().project(cam)
      if (v.z > 1) return null
      return { x: ((v.x + 1) / 2) * W, y: ((-v.y + 1) / 2) * H }
    },
    []
  )

  // ─── Three.js setup ───────────────────────────────────────────────────────

  const setupThree = useCallback((canvas: HTMLCanvasElement) => {
    const W = window.innerWidth
    const H = window.innerHeight

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(W, H)
    renderer.setClearColor(0x000000, 0)
    rendererRef.current = renderer

    const camera = new THREE.PerspectiveCamera(V_FOV_DEG, W / H, 0.01, 500)
    cameraRef.current = camera

    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffffff, 1.0))
    const dir = new THREE.DirectionalLight(0xffffff, 1.5)
    dir.position.set(0, 5, 5)
    scene.add(dir)
    sceneRef.current = scene
  }, [])

  /** Create (or return cached) Three.js group for a detected tag. */
  const getOrCreateTagMesh = useCallback((id: number): THREE.Group => {
    if (tagMeshes.current.has(id)) return tagMeshes.current.get(id)!

    const color = new THREE.Color(tagColor(id))
    const group = new THREE.Group()

    // Flat border frame at the tag plane
    const frameGeo = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(TAG_SIZE_METERS, 0.003, TAG_SIZE_METERS)
    )
    const frameMat = new THREE.LineBasicMaterial({ color })
    group.add(new THREE.LineSegments(frameGeo, frameMat))

    // Floating cube above the tag
    const cubeSize = TAG_SIZE_METERS * 0.75
    const cubeGeo = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize)
    const cubeMat = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.65,
      roughness: 0.3,
      metalness: 0.5,
    })
    const cube = new THREE.Mesh(cubeGeo, cubeMat)
    cube.position.y = TAG_SIZE_METERS * 0.5 + cubeSize / 2
    group.add(cube)

    // Vertical pillar connecting tag to cube
    const pillarGeo = new THREE.CylinderGeometry(0.004, 0.004, TAG_SIZE_METERS * 0.5, 8)
    const pillarMat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.8 })
    const pillar = new THREE.Mesh(pillarGeo, pillarMat)
    pillar.position.y = TAG_SIZE_METERS * 0.25
    group.add(pillar)

    sceneRef.current!.add(group)
    tagMeshes.current.set(id, group)
    return group
  }, [])

  /** Load the navmesh GLB and add to scene (hidden until anchored). */
  const loadNavmesh = useCallback(() => {
    if (navmeshLoadedRef.current || !sceneRef.current) return
    navmeshLoadedRef.current = true

    const loader = new GLTFLoader()
    loader.load(
      '/SM_MFF.glb',
      gltf => {
        const group = gltf.scene
        // Semi-transparent material for all meshes
        group.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh
            mesh.material = new THREE.MeshStandardMaterial({
              color: 0x4488ff,
              transparent: true,
              opacity: 0.25,
              side: THREE.DoubleSide,
              wireframe: false,
            })
          }
        })
        group.visible = false
        sceneRef.current!.add(group)
        navmeshRef.current = group
      },
      undefined,
      err => console.warn('Navmesh load error:', err)
    )
  }, [])

  /** Apply similarity transform to navmesh (reads from refs — safe inside RAF loop). */
  const applyNavmeshTransform = useCallback(() => {
    const nm = navmeshRef.current
    if (!nm) return

    const a0 = anchor0Ref.current
    const a1 = anchor1Ref.current

    const p0Cam = anchorPositions.current.get(a0.tagId)
    const p1Cam = anchorPositions.current.get(a1.tagId)
    if (!p0Cam || !p1Cam) return

    const p0Nav = getZoneNavXZ(a0.zoneId)
    const p1Nav = getZoneNavXZ(a1.zoneId)

    const xf = computeNavmeshTransform(p0Nav, p1Nav, p0Cam, p1Cam)

    nm.scale.setScalar(xf.scale)
    nm.rotation.set(0, xf.rotationY, 0)
    nm.position.set(xf.tx, xf.ty, xf.tz)
    nm.visible = true
    setNavmeshAnchored(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Detection loop ───────────────────────────────────────────────────────

  const startLoop = useCallback(() => {
    const video    = videoRef.current
    const detCv    = detCanvasRef.current
    const renderer = rendererRef.current
    const scene    = sceneRef.current
    const camera   = cameraRef.current
    if (!video || !detCv || !renderer || !scene || !camera) return

    const detCtx = detCv.getContext('2d', { willReadFrequently: true })!
    const intrinsics = estimateIntrinsics(DET_WIDTH, DET_HEIGHT, V_FOV_DEG)
    const W = window.innerWidth
    const H = window.innerHeight

    // Scale from detection canvas → full screen (for pose estimation use DET res intrinsics)
    const scaleX = DET_WIDTH  / (video.videoWidth  || DET_WIDTH)
    const scaleY = DET_HEIGHT / (video.videoHeight || DET_HEIGHT)

    let labelUpdateTimer = 0

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      if (video.readyState < 2) return

      detFrameCount.current++
      const detect = detFrameCount.current % 2 === 0 && detectorRef.current

      if (detect) {
        // Draw downscaled video frame
        detCtx.drawImage(video, 0, 0, DET_WIDTH, DET_HEIGHT)
        const imageData = detCtx.getImageData(0, 0, DET_WIDTH, DET_HEIGHT)

        let rawMarkers: any[] = []
        try {
          rawMarkers = detectorRef.current.detect(imageData) ?? []
        } catch { /* detector not ready */ }

        const detected: DetectedMarker[] = rawMarkers.map((m: any) => {
          // Scale corners back to detection-canvas resolution (already in det-canvas space)
          const corners: TagCorner[] = (m.corners as any[]).map((c: any) => ({
            x: c.x / scaleX,
            y: c.y / scaleY,
          }))
          const pose = computePose(corners, TAG_SIZE_METERS, intrinsics)
          return { id: m.id, corners: m.corners, center: m.center, pose }
        })

        lastDetections.current = detected

        // Update Three.js tag meshes
        const detectedIds = new Set<number>()
        for (const det of detected) {
          detectedIds.add(det.id)
          if (!det.pose) continue

          const group = getOrCreateTagMesh(det.id)
          const mat = new THREE.Matrix4()
          mat.fromArray(det.pose.matrix4)
          group.matrix.copy(mat)
          group.matrixAutoUpdate = false
          group.visible = true

          // Store anchor position for navmesh transform
          const a0id = anchor0Ref.current.tagId
          const a1id = anchor1Ref.current.tagId
          if (det.id === a0id || det.id === a1id) {
            anchorPositions.current.set(det.id, det.pose.translation)
          }
        }

        // Hide meshes for tags no longer in frame
        tagMeshes.current.forEach((group, id) => {
          if (!detectedIds.has(id)) group.visible = false
        })

        // Update navmesh anchor status
        const curA0 = anchor0Ref.current.tagId
        const curA1 = anchor1Ref.current.tagId
        const a0Found = detectedIds.has(curA0)
        const a1Found = detectedIds.has(curA1)
        setAnchorStatus({ a0: a0Found, a1: a1Found })

        // Anchor navmesh when both tags detected in phase 2
        if (phaseRef.current === 2 && a0Found && a1Found) {
          applyNavmeshTransform()
        } else if (phaseRef.current !== 2 && navmeshRef.current) {
          navmeshRef.current.visible = false
        }

        // Throttle label updates (every ~100 ms)
        labelUpdateTimer++
        if (labelUpdateTimer >= 6) {
          labelUpdateTimer = 0
          const newLabels: LabelInfo[] = []
          for (const det of detected) {
            if (!det.pose) continue
            const pos3d = new THREE.Vector3(...det.pose.translation)
            const sp = projectToScreen(pos3d, W, H)
            if (!sp) continue

            const zoneName = ZONES.find((_, i) => i === det.id)?.display_name
            newLabels.push({
              id: det.id,
              screenX: sp.x,
              screenY: sp.y,
              distance: det.pose.distance,
              label: zoneName ?? `Tag #${det.id}`,
              color: tagColor(det.id),
            })
          }
          setLabels(newLabels)
        }
      }

      renderer.render(scene, camera)
    }

    loop()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Effects ──────────────────────────────────────────────────────────────

  // Init detector (js-aruco2 with APRILTAG_36h11 dictionary)
  useEffect(() => {
    const init = async () => {
      try {
        // Vite's CJS interop handles the require() chain between aruco.js and the dictionary
        const arucoMod = await import('js-aruco2/src/aruco.js' as any)
        await import('js-aruco2/src/dictionaries/apriltag_36h11.js' as any)
        const AR = (arucoMod as any).AR ?? (arucoMod.default as any)?.AR
        if (!AR) throw new Error('AR not found')
        detectorRef.current = new AR.Detector({ dictionaryName: 'APRILTAG_36h11' })
        setDetectorStatus('ready')
      } catch (e) {
        console.error('Detector init error:', e)
        setDetectorStatus('error')
      }
    }
    init()
  }, [])

  // Camera + Three.js setup
  useEffect(() => {
    const canvas = threeCanvasRef.current
    if (!canvas) return
    setupThree(canvas)

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => {
            videoRef.current!.play().then(startLoop)
          }
        }
      } catch (err) {
        console.error('Camera error:', err)
        alert('Нет доступа к камере. AR режим недоступен.')
        setArMode(false)
      }
    }
    startCamera()

    return () => {
      cancelAnimationFrame(rafRef.current)
      if (videoRef.current?.srcObject) {
        ;(videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop())
      }
      rendererRef.current?.dispose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reload navmesh when entering phase 2
  useEffect(() => {
    if (phase === 2) loadNavmesh()
    if (phase === 1 && navmeshRef.current) {
      navmeshRef.current.visible = false
      setNavmeshAnchored(false)
    }
  }, [phase, loadNavmesh])

  // ─── UI helpers ───────────────────────────────────────────────────────────

  const handlePhaseToggle = () => {
    setPhase(p => (p === 1 ? 2 : 1))
    setNavmeshAnchored(false)
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">

      {/* ── Camera feed ───────────────────────────────────────────────── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* ── Hidden detection canvas ────────────────────────────────────── */}
      <canvas
        ref={detCanvasRef}
        width={DET_WIDTH}
        height={DET_HEIGHT}
        className="hidden"
      />

      {/* ── Three.js AR overlay ────────────────────────────────────────── */}
      <canvas
        ref={threeCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ mixBlendMode: 'normal' }}
      />

      {/* ── HTML label overlay ─────────────────────────────────────────── */}
      {labels.map(lbl => (
        <div
          key={lbl.id}
          className="absolute pointer-events-none select-none"
          style={{
            left: lbl.screenX,
            top: lbl.screenY,
            transform: 'translate(-50%, -130%)',
          }}
        >
          <div
            className="px-2 py-1 rounded-lg text-xs font-bold shadow-lg text-white"
            style={{ backgroundColor: lbl.color + 'cc', border: `2px solid ${lbl.color}` }}
          >
            <div>{lbl.label}</div>
            <div className="opacity-75 text-center">{lbl.distance.toFixed(2)}м</div>
          </div>
          {/* Triangle pointer */}
          <div
            className="w-0 h-0 mx-auto"
            style={{
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: `6px solid ${lbl.color}cc`,
            }}
          />
        </div>
      ))}

      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-20">
        <button
          onClick={() => setArMode(false)}
          className="bg-gray-900/80 backdrop-blur-sm text-white px-4 py-2 rounded-full text-sm font-semibold shadow-lg hover:bg-gray-800 transition"
        >
          ← Карта
        </button>

        <div className="flex items-center gap-2">
          {/* Phase toggle */}
          <button
            onClick={handlePhaseToggle}
            className={`px-3 py-1.5 rounded-full text-xs font-bold shadow transition ${
              phase === 1
                ? 'bg-blue-600/90 text-white'
                : 'bg-purple-600/90 text-white'
            }`}
          >
            {phase === 1 ? '📦 Фаза 1' : '🗺 Фаза 2'}
          </button>

          {/* Detector status */}
          <div
            className={`w-3 h-3 rounded-full ${
              detectorStatus === 'ready'
                ? 'bg-green-400'
                : detectorStatus === 'loading'
                ? 'bg-yellow-400 animate-pulse'
                : 'bg-red-500'
            }`}
            title={`Детектор: ${detectorStatus}`}
          />
        </div>
      </div>

      {/* ── Phase 1 hint ───────────────────────────────────────────────── */}
      {phase === 1 && labels.length === 0 && detectorStatus === 'ready' && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 text-center pointer-events-none">
          <div className="bg-gray-900/80 backdrop-blur-sm text-white px-5 py-3 rounded-2xl text-sm shadow-xl">
            <div className="text-base mb-1">📷 Наведите на AprilTag</div>
            <div className="opacity-70">tag36h11 — 19 cm</div>
          </div>
        </div>
      )}

      {/* ── Phase 2 status + config ────────────────────────────────────── */}
      {phase === 2 && (
        <div className="absolute bottom-24 left-4 right-4 z-20">
          {/* Anchor status bar */}
          <div className="bg-gray-900/85 backdrop-blur-sm rounded-2xl px-4 py-3 mb-3 shadow-xl">
            <div className="flex justify-between items-center mb-2">
              <span className="text-white text-sm font-semibold">Навмеш-якоря</span>
              <button
                onClick={() => setShowConfig(v => !v)}
                className="text-gray-300 text-xs underline"
              >
                {showConfig ? 'Скрыть' : 'Настройка'}
              </button>
            </div>
            <div className="flex gap-4 text-sm">
              <span>
                <span className={anchorStatus.a0 ? 'text-green-400' : 'text-red-400'}>
                  {anchorStatus.a0 ? '✓' : '✗'}
                </span>
                <span className="text-gray-300 ml-1">
                  Tag {anchor0.tagId} — {getZone(anchor0.zoneId)?.display_name ?? '—'}
                </span>
              </span>
              <span>
                <span className={anchorStatus.a1 ? 'text-green-400' : 'text-red-400'}>
                  {anchorStatus.a1 ? '✓' : '✗'}
                </span>
                <span className="text-gray-300 ml-1">
                  Tag {anchor1.tagId} — {getZone(anchor1.zoneId)?.display_name ?? '—'}
                </span>
              </span>
            </div>
            {navmeshAnchored && (
              <div className="mt-2 text-green-400 font-semibold text-sm">
                🟢 Навмеш закреплён
              </div>
            )}
          </div>

          {/* Config panel */}
          {showConfig && (
            <div className="bg-gray-900/90 backdrop-blur-sm rounded-2xl px-4 py-4 shadow-xl text-white text-sm space-y-4">
              {/* Anchor 0 */}
              <div>
                <div className="font-semibold mb-1.5">Якорь 0</div>
                <div className="flex gap-2 items-center">
                  <label className="text-gray-400 text-xs w-16">Tag ID:</label>
                  <input
                    type="number"
                    min={0}
                    max={586}
                    value={anchor0.tagId}
                    onChange={e => setAnchor0(a => ({ ...a, tagId: Number(e.target.value) }))}
                    className="w-16 bg-gray-700 text-white rounded px-2 py-1 text-xs"
                  />
                  <label className="text-gray-400 text-xs w-12">Зона:</label>
                  <select
                    value={anchor0.zoneId}
                    onChange={e => setAnchor0(a => ({ ...a, zoneId: e.target.value }))}
                    className="flex-1 bg-gray-700 text-white rounded px-2 py-1 text-xs"
                  >
                    {ZONES.map(z => (
                      <option key={z.id} value={z.id}>
                        {z.display_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Anchor 1 */}
              <div>
                <div className="font-semibold mb-1.5">Якорь 1</div>
                <div className="flex gap-2 items-center">
                  <label className="text-gray-400 text-xs w-16">Tag ID:</label>
                  <input
                    type="number"
                    min={0}
                    max={586}
                    value={anchor1.tagId}
                    onChange={e => setAnchor1(a => ({ ...a, tagId: Number(e.target.value) }))}
                    className="w-16 bg-gray-700 text-white rounded px-2 py-1 text-xs"
                  />
                  <label className="text-gray-400 text-xs w-12">Зона:</label>
                  <select
                    value={anchor1.zoneId}
                    onChange={e => setAnchor1(a => ({ ...a, zoneId: e.target.value }))}
                    className="flex-1 bg-gray-700 text-white rounded px-2 py-1 text-xs"
                  >
                    {ZONES.map(z => (
                      <option key={z.id} value={z.id}>
                        {z.display_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="text-gray-400 text-xs">
                Размер тега: {TAG_SIZE_METERS * 100} см (tag36h11)
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Detected tags list (Phase 1) ────────────────────────────────── */}
      {phase === 1 && labels.length > 0 && (
        <div className="absolute top-16 right-4 z-20 space-y-1.5">
          {labels.map(lbl => (
            <div
              key={lbl.id}
              className="flex items-center gap-2 bg-gray-900/80 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow"
            >
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: lbl.color }} />
              <span className="text-white text-xs font-medium">Tag #{lbl.id}</span>
              <span className="text-gray-400 text-xs">{lbl.distance.toFixed(1)}м</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Loading overlay ─────────────────────────────────────────────── */}
      {detectorStatus === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-30">
          <div className="text-white text-center">
            <div className="text-4xl mb-3 animate-spin">⚙️</div>
            <div className="text-lg font-semibold">Инициализация детектора…</div>
          </div>
        </div>
      )}

      {detectorStatus === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-30">
          <div className="text-white text-center px-8">
            <div className="text-4xl mb-3">❌</div>
            <div className="text-lg font-semibold mb-2">Детектор недоступен</div>
            <div className="text-sm text-gray-300 mb-6">
              Проверьте подключение к интернету
            </div>
            <button
              onClick={() => setArMode(false)}
              className="bg-white/10 border border-white/30 text-white px-6 py-2 rounded-full"
            >
              Назад
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
