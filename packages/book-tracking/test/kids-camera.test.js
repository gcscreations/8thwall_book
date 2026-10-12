import test from 'node:test'
import assert from 'node:assert/strict'
import {createKidsCameraController} from '../src/kids-camera.js'

function mockTrack({capabilities={},initialConstraints={facingMode:'environment',width:{ideal:1280}}, initialSettings={zoom:1},fail=false}={}) {
  const calls=[]
  const eventListeners = new Map()
  const track={
    readyState:'live',
    calls,
    getCapabilities:()=>capabilities,
    getConstraints:()=>({...initialConstraints}),
    getSettings:()=>({...initialSettings}),
    async applyConstraints(options) {
      calls.push(options)
      if (fail) throw new Error('Camera rejected constraint')
      const {focusMode,zoom}=options
      if(focusMode !== undefined) initialSettings.focusMode=focusMode
      else delete initialSettings.focusMode
      if(zoom !== undefined) initialSettings.zoom=zoom
      else initialSettings.zoom=1
    },
    addEventListener(name,handler){eventListeners.set(name,handler)},
    removeEventListener(name,handler){if(eventListeners.get(name)===handler)eventListeners.delete(name)},
    end(){this.readyState='ended';eventListeners.get('ended')?.()},
  }
  return track
}
const stream=track=>({getVideoTracks:()=>[track]})
const attach=(controller,track)=>controller.bindStream(stream(track))

test('Android Chrome: Kids Mode requests continuous focus while preserving camera constraints', async()=>{
  const track=mockTrack({capabilities:{focusMode:['manual','continuous'],zoom:{min:1,max:4,step:.1}}})
  const controller=createKidsCameraController()
  attach(controller,track)
  await controller.whenIdle()
  assert.equal(track.calls.length,1)
  assert.equal(track.calls[0].focusMode,'continuous')
  assert.equal(track.calls[0].facingMode,'environment')
  assert.deepEqual(track.calls[0].width,{ideal:1280})
  assert.equal('zoom' in track.calls[0],false)
  assert.equal(controller.getState().focusState,'confirmed')
  assert.equal(controller.getState().zoomEnabled,false)
  controller.dispose()
})

test('iPhone Safari without focusMode or zoom: device-managed fallback, camera stays available',async()=>{
  const track=mockTrack({capabilities:{width:{min:320,max:1920}},initialSettings:{}})
  const controller=createKidsCameraController()
  attach(controller,track)
  await controller.whenIdle()
  assert.equal(track.calls.length,0)
  assert.equal(controller.getState().ready,true)
  assert.equal(controller.getState().focusAvailable,false)
  assert.equal(controller.getState().message,'Using phone-managed autofocus')
  assert.deepEqual(await controller.setZoom(0.7),{ok:false,reason:'Zoom locked to preserve AR alignment'})
  controller.dispose()
})

test('normal mode restores original constraints without replacing the stream',async()=>{
  const track=mockTrack({capabilities:{focusMode:['continuous']}})
  const controller=createKidsCameraController()
  attach(controller,track)
  await controller.whenIdle()
  await controller.setMode('normal')
  assert.equal(track.calls.length,2)
  assert.deepEqual(track.calls[1],{facingMode:'environment',width:{ideal:1280}})
  assert.equal(controller.getState().mode,'normal')
  assert.equal(controller.getState().focusState,'device-managed')
  controller.dispose()
})

test('optional zoom only within actual range and only when pages are not tracked',async()=>{
  let tracking=true
  const track=mockTrack({capabilities:{focusMode:['continuous'],zoom:{min:.5,max:2,step:.1}}})
  const controller=createKidsCameraController({allowZoom:true,isBookTracked:()=>tracking})
  attach(controller,track)
  await controller.whenIdle()
  assert.equal((await controller.setZoom(.7)).ok,false)
  assert.equal(track.calls.length,1)
  tracking=false
  assert.equal((await controller.setZoom(.4)).ok,false)
  assert.equal((await controller.setZoom(.7)).ok,true)
  assert.equal(track.calls.at(-1).zoom,.7)
  assert.equal(controller.getState().actualZoom,.7)
  controller.dispose()
})

test('iPhone focusMode rejection falls back without ending stream', async()=>{
  const track=mockTrack({capabilities:{focusMode:['continuous']},fail:true})
  const controller=createKidsCameraController()
  attach(controller,track)
  await controller.whenIdle()
  assert.equal(controller.getState().ready,true)
  assert.match(controller.getState().message,/did not accept/)
  assert.equal(controller.getState().focusState,'device-managed')
  controller.dispose()
})

test('camera stream replacement and end update controls safely',async()=>{
  const one=mockTrack({capabilities:{focusMode:['continuous']}})
  const two=mockTrack({capabilities:{}})
  const controller=createKidsCameraController()
  attach(controller,one)
  await controller.whenIdle()
  attach(controller,two)
  await controller.whenIdle()
  assert.equal(controller.getState().focusAvailable,false)
  one.end()
  assert.equal(controller.getState().ready,true)
  two.end()
  assert.equal(controller.getState().ready,false)
  controller.dispose()
})

test('pipeline uses hasVideo as a fallback and ignores missing streams',async()=>{
  const t=mockTrack({capabilities:{focusMode:['continuous']}})
  const controller=createKidsCameraController()
  const pipeline=controller.pipelineModule()
  pipeline.onCameraStatusChange({status:'hasStream',stream:stream(t)})
  assert.equal(t.calls.length,0)
  pipeline.onCameraStatusChange({status:'hasVideo',video:{srcObject:stream(t)}})
  await controller.whenIdle()
  assert.equal(controller.getState().ready,true)
  pipeline.onCameraStatusChange({status:'requesting'})
  assert.equal(controller.getState().ready,false)
  controller.dispose()
})

test('unsupported getCapabilities and missing applyConstraints cause no crash',async()=>{
  const t=mockTrack()
  t.getCapabilities=()=>{throw new Error('old browser')}
  t.applyConstraints=undefined
  const controller=createKidsCameraController()
  attach(controller,t)
  await controller.whenIdle()
  assert.equal(controller.getState().ready,true)
  assert.equal(controller.getState().focusAvailable,false)
  controller.dispose()
})

test('unsupported requested zoom is cleared when switching to a camera with a smaller range',async()=>{
  const one=mockTrack({capabilities:{zoom:{min:.5,max:3}},initialSettings:{zoom:1}})
  const two=mockTrack({capabilities:{zoom:{min:1,max:2}},initialSettings:{zoom:1}})
  const controller=createKidsCameraController({allowZoom:true})
  attach(controller,one)
  await controller.whenIdle()
  assert.equal((await controller.setZoom(.5)).ok,true)
  attach(controller,two)
  await controller.whenIdle()
  assert.equal(controller.getState().requestedZoom,null)
  assert.equal(two.calls.length,0)
  controller.dispose()
})

test('zoom is disabled in Normal Mode even on capable devices',async()=>{
  const t=mockTrack({capabilities:{zoom:{min:.5,max:4}}})
  const controller=createKidsCameraController({allowZoom:true})
  attach(controller,t)
  await controller.whenIdle()
  await controller.setMode('normal')
  assert.equal((await controller.setZoom(2)).ok,false)
  assert.equal(t.calls.length,0)
  controller.dispose()
})

test('rapid Kids/Normal selection ends with Normal Mode and baseline camera constraints',async()=>{
  const t=mockTrack({capabilities:{focusMode:['continuous']}})
  const controller=createKidsCameraController()
  attach(controller,t)
  const toNormal=controller.setMode('normal')
  const toKids=controller.setMode('kids')
  const againNormal=controller.setMode('normal')
  await Promise.all([toNormal,toKids,againNormal])
  assert.equal(controller.getState().mode,'normal')
  assert.equal(t.calls.length,0)
  controller.dispose()
})
