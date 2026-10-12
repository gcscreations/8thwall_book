// Utilities for rigid left/right book pages tracked with separate image targets.
// Pose rotation uses normalized quaternions with x, y, z, w fields.

const R2D = 180 / Math.PI
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
export const dot = (a, b) => a.x*b.x + a.y*b.y + a.z*b.z
export const subtract = (a, b) => ({x:a.x-b.x, y:a.y-b.y, z:a.z-b.z})
export const length = p => Math.hypot(p.x, p.y, p.z)
export const cross = (a, b) => ({
  x: a.y*b.z - a.z*b.y,
  y: a.z*b.x - a.x*b.z,
  z: a.x*b.y - a.y*b.x,
})
const normalized = v => {
  const n = length(v)
  return n > 1e-9 ? {x:v.x/n, y:v.y/n, z:v.z/n} : {x:0, y:1, z:0}
}

/** Rotate a vector using a UNIT quaternion. */
export function rotateVector(q, v) {
  const {x,y,z,w} = q
  const tx = 2 * (y*v.z-z*v.y)
  const ty = 2 * (z*v.x-x*v.z)
  const tz = 2 * (x*v.y-y*v.x)
  return {
    x: v.x + w*tx + y*tz-z*ty,
    y: v.y + w*ty + z*tx-x*tz,
    z: v.z + w*tz + x*ty-y*tx,
  }
}

/** 0-degree bend = flat spread; 180-degree opening = flat spread. */
export function foldAngles(leftRotation, rightRotation) {
  const ln = normalized(rotateVector(leftRotation, {x:0,y:0,z:1}))
  const rn = normalized(rotateVector(rightRotation, {x:0,y:0,z:1}))
  const lu = normalized(rotateVector(leftRotation, {x:0,y:1,z:0}))
  const ru = normalized(rotateVector(rightRotation, {x:0,y:1,z:0}))
  const hinge = normalized({x:lu.x+ru.x, y:lu.y+ru.y, z:lu.z+ru.z})
  const cosine = clamp(dot(ln,rn), -1, 1)
  const bendDegrees = Math.acos(cosine)*R2D
  return {
    bendDegrees,
    openingDegrees: 180-bendDegrees,
    signedBendDegrees: Math.atan2(dot(cross(ln,rn), hinge), cosine)*R2D,
  }
}

/**
 * Recover full printed-page geometry from a cropped 8th Wall image target pose.
 * The returned offsets are relative to the tracked crop's center.
 * Crop rotation is intentionally unsupported until remapped explicitly.
 */
export function fullPageGeometry({scaledWidth,scaledHeight,scale=1,properties={}}) {
  const cropWidth = Number(properties.width) || 1
  const cropHeight = Number(properties.height) || 1
  const originalWidth = Number(properties.originalWidth) || cropWidth
  const originalHeight = Number(properties.originalHeight) || cropHeight
  const left = Number(properties.left) || 0
  const top = Number(properties.top) || 0
  const imageW = Number(scaledWidth)*scale
  const imageH = Number(scaledHeight)*scale
  if (![imageW,imageH,cropWidth,cropHeight,originalWidth,originalHeight].every(
    n=> Number.isFinite(n) && n>0
  )) throw new Error('Invalid image target dimensions')
  if (properties.isRotated) throw new Error('Rotated target crops need explicit remapping')
  return {
    width: imageW*originalWidth/cropWidth,
    height: imageH*originalHeight/cropHeight,
    offsetX: imageW*(originalWidth/2-left-cropWidth/2)/cropWidth,
    offsetY: -imageH*(originalHeight/2-top-cropHeight/2)/cropHeight,
  }
}

/** The local inner edge of the physical page transformed to world coordinates. */
export function spinePoint(pose,rect,side) {
  if (!['left','right'].includes(side)) throw new Error('Invalid page side')
  const delta = rotateVector(pose.rotation, {
    x: rect.offsetX+(side==='left' ? rect.width/2 : -rect.width/2),
    y: rect.offsetY,
    z: 0,
  })
  return {
    x: pose.position.x+delta.x,
    y: pose.position.y+delta.y,
    z: pose.position.z+delta.z,
  }
}
