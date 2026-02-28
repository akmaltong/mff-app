/**
 * Pose estimation for square fiducial markers (AprilTag / ArUco).
 * Uses 4-corner homography decomposition.
 *
 * Coordinate conventions:
 *  - OpenCV camera:  X right, Y down, Z forward
 *  - Three.js world: X right, Y up,   Z back
 *  - Tag local:      X right, Y up,   Z out-of-tag toward camera
 *
 * The output matrix4 is a column-major 16-element array suitable for
 * THREE.Matrix4.fromArray() — it positions and orients the 3D object
 * at the tag's physical location relative to the camera (camera at origin).
 */

export interface TagCorner { x: number; y: number }
export interface CameraIntrinsics { fx: number; fy: number; cx: number; cy: number }

/** Estimate camera intrinsics from resolution and vertical FOV (degrees). */
export function estimateIntrinsics(
  width: number,
  height: number,
  vFovDeg = 70
): CameraIntrinsics {
  const f = height / (2 * Math.tan((vFovDeg * Math.PI) / 360))
  return { fx: f, fy: f, cx: width / 2, cy: height / 2 }
}

// ─── Linear algebra helpers ────────────────────────────────────────────────

function norm3(v: number[]): number {
  return Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
}
function normalize3(v: number[]): number[] {
  const n = norm3(v)
  return n < 1e-10 ? [0, 0, 0] : v.map(x => x / n)
}
function cross3(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

/**
 * Solve Ax = b via Gaussian elimination with partial pivoting.
 * A is n×n, b is length-n. Returns x.
 */
function gaussSolve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])

  for (let c = 0; c < n; c++) {
    // Pivot
    let maxR = c
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(M[r][c]) > Math.abs(M[maxR][c])) maxR = r
    }
    ;[M[c], M[maxR]] = [M[maxR], M[c]]

    const pivot = M[c][c]
    if (Math.abs(pivot) < 1e-12) continue

    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / pivot
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }

  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    x[r] = M[r][n]
    for (let c = r + 1; c < n; c++) x[r] -= M[r][c] * x[c]
    x[r] /= M[r][r]
  }
  return x
}

// ─── Homography ─────────────────────────────────────────────────────────────

/**
 * Compute 3×3 homography H from 4 corresponding point pairs.
 *   dst_hom = H * src_hom   (homogeneous 2D)
 *
 * We fix H[2][2] = 1 and solve the resulting 8×8 linear system.
 *
 * @param src  Source 2D points (tag object plane XY, meters)
 * @param dst  Destination 2D points (normalized image coords: (u-cx)/fx, (v-cy)/fy)
 */
export function computeHomography(
  src: [number, number][],
  dst: [number, number][]
): number[][] {
  const rows: number[][] = []
  const rhs: number[] = []

  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]
    const [u, v] = dst[i]
    rows.push([-x, -y, -1,  0,  0,  0, u * x, u * y])
    rhs.push(-u)
    rows.push([ 0,  0,  0, -x, -y, -1, v * x, v * y])
    rhs.push(-v)
  }

  const h = gaussSolve(rows, rhs)
  h.push(1) // h[8] = 1 (fixed scale)

  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], h[8]],
  ]
}

// ─── Pose decomposition ──────────────────────────────────────────────────────

/**
 * Decompose the homography H = [r1 | r2 | t] (already in normalized image space,
 * i.e. H = K⁻¹ * [r1|r2|t]) into rotation matrix and translation vector.
 *
 * Returns rotation R (3×3, row-major) and translation t in the
 * OpenCV camera coordinate frame (X right, Y down, Z forward).
 */
function decomposeH(H: number[][]): {
  R: number[][]
  t: number[]
  distance: number
} {
  const c0 = [H[0][0], H[1][0], H[2][0]] // first column  → r1
  const c1 = [H[0][1], H[1][1], H[2][1]] // second column → r2
  const c2 = [H[0][2], H[1][2], H[2][2]] // third column  → t (unscaled)

  const scale = (norm3(c0) + norm3(c1)) / 2
  if (scale < 1e-10) throw new Error('Degenerate homography')

  const r1 = normalize3(c0)
  const r2_raw = normalize3(c1)
  const r3 = cross3(r1, r2_raw)
  const r2 = cross3(r3, r1) // re-orthogonalise

  const t = c2.map(v => v / scale)

  // Ensure tag is in front of the camera (positive Z in OpenCV = forward)
  const sign = t[2] >= 0 ? 1 : -1
  const R: number[][] = [
    [sign * r1[0], sign * r2[0], sign * r3[0]],
    [sign * r1[1], sign * r2[1], sign * r3[1]],
    [sign * r1[2], sign * r2[2], sign * r3[2]],
  ]
  const tv = t.map(v => sign * v)

  return { R, t: tv, distance: norm3(tv) }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface PoseResult {
  /** Column-major 16-element array for THREE.Matrix4.fromArray() */
  matrix4: number[]
  /** Tag center in Three.js world space (camera at origin) */
  translation: [number, number, number]
  /** Distance from camera to tag center (metres) */
  distance: number
}

/**
 * Compute 6DOF pose of a square fiducial marker from its 4 detected corners.
 *
 * @param corners       Detected corners in image pixels, clockwise: TL, TR, BR, BL
 * @param tagSizeMeters Physical side length of the printed marker (e.g. 0.19)
 * @param intrinsics    Camera intrinsics (use estimateIntrinsics() if unknown)
 * @returns             Pose result, or null if computation fails
 */
export function computePose(
  corners: TagCorner[],
  tagSizeMeters: number,
  intrinsics: CameraIntrinsics
): PoseResult | null {
  if (corners.length < 4) return null

  const { fx, fy, cx, cy } = intrinsics
  const h = tagSizeMeters / 2

  // Tag object-plane corners: TL=(-h,+h), TR=(+h,+h), BR=(+h,-h), BL=(-h,-h)
  // (X right, Y up in tag space — consistent with standard orientation)
  const objPts: [number, number][] = [
    [-h,  h], // TL
    [ h,  h], // TR
    [ h, -h], // BR
    [-h, -h], // BL
  ]

  // Normalised image coordinates
  const imgPts: [number, number][] = corners.map(c => [
    (c.x - cx) / fx,
    (c.y - cy) / fy,
  ])

  try {
    const H = computeHomography(objPts, imgPts)
    const { R, t, distance } = decomposeH(H)

    // Convert OpenCV (X right, Y down, Z fwd) → Three.js (X right, Y up, Z back):
    //   flip rows 1 and 2:  Y_gl = −Y_cv,  Z_gl = −Z_cv
    // Column-major layout for THREE.Matrix4.fromArray():
    //   elements[0..3]  = column 0, elements[4..7] = column 1, …
    const matrix4 = [
      // col 0 (object X-axis in Three.js world)
       R[0][0], -R[1][0], -R[2][0], 0,
      // col 1 (object Y-axis)
       R[0][1], -R[1][1], -R[2][1], 0,
      // col 2 (object Z-axis)
       R[0][2], -R[1][2], -R[2][2], 0,
      // col 3 (translation)
       t[0],    -t[1],    -t[2],    1,
    ]

    const translation: [number, number, number] = [t[0], -t[1], -t[2]]

    return { matrix4, translation, distance }
  } catch {
    return null
  }
}

// ─── Navmesh similarity transform ────────────────────────────────────────────

export interface NavmeshTransform {
  scale: number
  rotationY: number   // radians, rotation around Y axis
  tx: number          // translation X in Three.js world
  ty: number          // translation Y (floor height)
  tz: number          // translation Z in Three.js world
}

/**
 * Compute a 2D similarity transform (scale + rotation in XZ + translation)
 * that maps navmesh coordinates to Three.js camera world coordinates.
 *
 * Assumptions:
 *  - The navmesh floor is horizontal (Y ≈ const).
 *  - Both anchor tags are on the same floor level.
 *
 * @param p0Nav   Anchor-0 position in navmesh space [x, z]
 * @param p1Nav   Anchor-1 position in navmesh space [x, z]
 * @param p0Cam   Anchor-0 3D position in Three.js world [x, y, z]
 * @param p1Cam   Anchor-1 3D position in Three.js world [x, y, z]
 */
export function computeNavmeshTransform(
  p0Nav: [number, number],
  p1Nav: [number, number],
  p0Cam: [number, number, number],
  p1Cam: [number, number, number]
): NavmeshTransform {
  const dSrcX = p1Nav[0] - p0Nav[0]
  const dSrcZ = p1Nav[1] - p0Nav[1]
  const srcLen = Math.sqrt(dSrcX ** 2 + dSrcZ ** 2)

  const dDstX = p1Cam[0] - p0Cam[0]
  const dDstZ = p1Cam[2] - p0Cam[2]
  const dstLen = Math.sqrt(dDstX ** 2 + dDstZ ** 2)

  if (srcLen < 1e-6 || dstLen < 1e-6) {
    return { scale: 1, rotationY: 0, tx: 0, ty: 0, tz: 0 }
  }

  const scale = dstLen / srcLen
  const srcAngle = Math.atan2(dSrcZ, dSrcX)
  const dstAngle = Math.atan2(dDstZ, dDstX)
  const rotationY = dstAngle - srcAngle

  // Translation: t = p0_cam - scale * R(rotY) * p0_nav
  const cosY = Math.cos(rotationY)
  const sinY = Math.sin(rotationY)
  const p0NavTx = scale * (cosY * p0Nav[0] - sinY * p0Nav[1])
  const p0NavTz = scale * (sinY * p0Nav[0] + cosY * p0Nav[1])

  return {
    scale,
    rotationY,
    tx: p0Cam[0] - p0NavTx,
    ty: p0Cam[1], // use anchor-0 floor level
    tz: p0Cam[2] - p0NavTz,
  }
}
