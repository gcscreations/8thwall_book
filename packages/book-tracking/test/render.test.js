import test from 'node:test'
import assert from 'node:assert/strict'
import {createPhysicalBookTracker} from '../src/index.js'

class Vector3 {
  constructor(x=0,y=0,z=0){this.set(x,y,z)}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this}
  copy(q){return this.set(q.x,q.y,q.z)}
  lerp(q,a){this.x+=(q.x-this.x)*a;this.y+=(q.y-this.y)*a;this.z+=(q.z-this.z)*a;return this}
  addScaledVector(v,a){this.x+=v.x*a;this.y+=v.y*a;this.z+=v.z*a;return this}
}
class Quaternion {
  constructor(x=0,y=0,z=0,w=1){this.set(x,y,z,w)}
  set(x,y,z,w){this.x=x;this.y=y;this.z=z;this.w=w;return this}
  copy(q){return this.set(q.x,q.y,q.z,q.w)}
  normalize(){const n=Math.hypot(this.x,this.y,this.z,this.w);this.x/=n;this.y/=n;this.z/=n;this.w/=n;return this}
  slerp(q,a){return this.set(this.x+(q.x-this.x)*a,this.y+(q.y-this.y)*a,
    this.z+(q.z-this.z)*a,this.w+(q.w-this.w)*a).normalize()}
}
class Group {
  constructor(){this.children=[];this.position=new Vector3();this.quaternion=new Quaternion();this.visible=true}
  add(child){this.children.push(child)}
  remove(child){this.children=this.children.filter(c=>c!==child)}
}
class PlaneGeometry {
  constructor(){const coords=[0,1,1,1,0,0,1,0]
    this.uv={count:4,needsUpdate:false,getX:i=>coords[i*2],setX:(i,v)=>{coords[i*2]=v}}}
  getAttribute(name){if(name!=='uv')throw Error(name);return this.uv}
  dispose(){this.disposed=true}
}
class MeshBasicMaterial {
  constructor(options){this.options=options}
  dispose(){this.disposed=true}
}
class Mesh {
  constructor(geometry,material){this.geometry=geometry;this.material=material;
    this.position=new Vector3();this.scale=new Vector3(1,1,1)}
}
class VideoTexture {
  constructor(video){this.video=video}
  dispose(){this.disposed=true}
}
const THREE={Vector3,Quaternion,Group,PlaneGeometry,MeshBasicMaterial,
  Mesh,VideoTexture,DoubleSide:2,LinearFilter:1}
const ID={x:0,y:0,z:0,w:1}
const pose=(name,x,rotation=ID)=>({
  name,position:{x,y:0,z:0},rotation,scaledWidth:0.75,scaledHeight:1,scale:1,
  properties:{originalWidth:1024,originalHeight:1152,left:80,top:0,
    width:864,height:1152,isRotated:false},
})

test('both page meshes share one texture and sample distinct video halves',()=>{
  const scene=new Group()
  const tracker=createPhysicalBookTracker({
    THREE,scene,video:{setAttribute:()=>{}},smoothingMs:0,seamCorrectionStrength:0
  })
  const {left,right}=tracker.getPageObjects()
  const lm=left.children[0],rm=right.children[0]
  assert.strictEqual(lm.material.options.map,rm.material.options.map)
  assert.strictEqual(lm.material.options.map,tracker.videoTexture)
  assert.deepEqual([0,1,2,3].map(i=>lm.geometry.uv.getX(i)),[0,0.5,0,0.5])
  assert.deepEqual([0,1,2,3].map(i=>rm.geometry.uv.getX(i)),[0.5,1,0.5,1])
  const x=1024/1152/2
  assert.equal(tracker.onPose(pose('page-left',-x)),true)
  assert.equal(tracker.onPose(pose('page-right',x)),true)
  const m=tracker.update(0)
  assert.equal(m.leftTracked,true);assert.equal(m.rightTracked,true)
  assert.ok(Math.abs(m.seamGap)<1e-6)
  assert.ok(Math.abs(m.bendDegrees)<1e-6)
  tracker.onLost({name:'page-right'})
  assert.equal(tracker.update(16).bendDegrees,null)
  assert.equal(right.visible,false)
  tracker.dispose()
  assert.equal(scene.children.length,0)
  assert.equal(tracker.videoTexture.disposed,true)
})
test('right-page rotation yields a 90-degree physical fold',()=>{
  const scene=new Group()
  const tracker=createPhysicalBookTracker({
    THREE,scene,video:{setAttribute:()=>{}},smoothingMs:0,seamCorrectionStrength:0
  })
  tracker.onPose(pose('page-left',-0.45))
  const r=Math.PI/4
  tracker.onPose(pose('page-right',0.45,{x:0,y:Math.sin(r),z:0,w:Math.cos(r)}))
  assert.ok(Math.abs(tracker.update(0).bendDegrees-90)<1e-5)
  tracker.dispose()
})
