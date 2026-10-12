import test from 'node:test'
import assert from 'node:assert/strict'
import {foldAngles,fullPageGeometry,spinePoint,rotateVector} from '../src/math.js'

const q0={x:0,y:0,z:0,w:1}
const rotateY=degrees=>{
  const h=degrees*Math.PI/360
  return {x:0,y:Math.sin(h),z:0,w:Math.cos(h)}
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6)

test('flat pages: bend 0, opening 180',()=>{
  near(foldAngles(q0,q0).bendDegrees,0)
  near(foldAngles(q0,q0).openingDegrees,180)
})
test('right angle: bend 90 and opening 90',()=>{
  const a=foldAngles(q0,rotateY(90))
  near(a.bendDegrees,90)
  near(a.openingDegrees,90)
  near(a.signedBendDegrees,90)
})
test('negative rotation produces negative signed angle',()=>{
  near(foldAngles(q0,rotateY(-45)).signedBendDegrees,-45)
})
test('quaternion rotates page normal correctly',()=>{
  const a=rotateVector(rotateY(90),{x:0,y:0,z:1})
  near(a.x,1);near(a.y,0);near(a.z,0)
})
test('CLI 3:4 tracking crop maps to full portrait page',()=>{
  const rect=fullPageGeometry({
    scaledWidth:0.75,scaledHeight:1,scale:1,
    properties:{originalWidth:1024,originalHeight:1152,
      left:80,top:0,width:864,height:1152,isRotated:false},
  })
  near(rect.width,1024/1152)
  near(rect.height,1)
  near(rect.offsetX,0);near(rect.offsetY,0)
})
test('asymmetric tracking crop maps to correct page offset',()=>{
  const rect=fullPageGeometry({scaledWidth:0.5,scaledHeight:1,
    properties:{originalWidth:1000,originalHeight:1000,left:0,top:0,width:500,height:1000}})
  near(rect.width,1);near(rect.offsetX,0.25)
})
test('hinge points meet for ideal flat book',()=>{
  const rect={width:1,height:1,offsetX:0,offsetY:0}
  const a=spinePoint({position:{x:-0.5,y:0,z:0},rotation:q0},rect,'left')
  const b=spinePoint({position:{x:0.5,y:0,z:0},rotation:q0},rect,'right')
  near(a.x,b.x);near(a.y,b.y);near(a.z,b.z)
})
test('rotated crops are rejected rather than misaligned',()=>{
  assert.throws(()=>fullPageGeometry({
    scaledWidth:1,scaledHeight:1,properties:{isRotated:true}
  }),/Rotated/)
})
