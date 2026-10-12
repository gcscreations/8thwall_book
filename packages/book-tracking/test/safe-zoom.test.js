import test from 'node:test'
import assert from 'node:assert/strict'
import {applyGuardedZoom} from '../src/safe-zoom.js'

const bookTracker=()=>{
  const events=[]
  return {
    events,
    suspendPresentation(reason){events.push(['pause',reason])},
    resumePresentation(options){events.push(['resume',options])},
    confirmAlignment(){events.push(['confirm']);return true},
  }
}
const makeTrack=({zoom=1,failAt=[],reportZoom=true}={})=>{
  let actual=zoom
  const calls=[]
  return {
    readyState:'live',
    calls,
    getConstraints:()=>({facingMode:'environment',zoom:actual}),
    getSettings:()=>reportZoom?{zoom:actual}:{},
    async applyConstraints(c){
      calls.push(c)
      if(failAt.includes(calls.length))throw new Error('Camera zoom rejected')
      actual=c.zoom
    },
  }
}
const options=(t,b)=>({
  track:t,zoom:1.4,previousZoom:1,baselineZoom:1,bookTracker:b,
  step:0.1,settleMs:0,wait:async()=>{},
})
test('success suspends overlays, applies to same rear track, then requires confirmation',async()=>{
  const t=makeTrack(),b=bookTracker()
  const r=await applyGuardedZoom(options(t,b))
  assert.deepEqual(r,{ok:true,appliedZoom:1.4,pendingAlignment:true})
  assert.deepEqual(b.events,[['pause','camera-zoom'],['resume',{requireConfirmation:true}]])
  assert.equal(t.calls.length,1)
  assert.equal(t.calls[0].facingMode,'environment')
})
test('resetting original zoom only requires fresh detections',async()=>{
  const t=makeTrack({zoom:1.4}),b=bookTracker()
  const r=await applyGuardedZoom({...options(t,b),zoom:1,previousZoom:1.4})
  assert.equal(r.ok,true)
  assert.equal(r.pendingAlignment,false)
  assert.deepEqual(b.events.at(-1),['resume',{requireConfirmation:false}])
})
test('rejected zoom rolls back and shows overlays only after rollback confirmed',async()=>{
  const t=makeTrack({failAt:[1]}),b=bookTracker()
  const r=await applyGuardedZoom(options(t,b))
  assert.equal(r.ok,false)
  assert.equal(r.rolledBack,true)
  assert.equal(t.calls.length,2)
  assert.deepEqual(b.events.at(-1),['resume',{requireConfirmation:false}])
})
test('zoom and rollback unverified: overlays remain hidden',async()=>{
  const t=makeTrack({reportZoom:false}),b=bookTracker()
  const r=await applyGuardedZoom(options(t,b))
  assert.equal(r.ok,false)
  assert.equal(r.restartRequired,true)
  assert.deepEqual(b.events,[['pause','camera-zoom']])
})
test('camera stream replacement does not resume the prior session',async()=>{
  const t=makeTrack(),b=bookTracker()
  let current=true
  const r=await applyGuardedZoom({...options(t,b),
    wait:async()=>{current=false},isCurrent:()=>current})
  assert.equal(r.ok,false)
  assert.equal(b.events.some(e=>e[0]==='resume'),false)
})
test('a missing book tracker or missing baseline refuses to touch camera',async()=>{
  const t=makeTrack()
  assert.equal((await applyGuardedZoom(options(t,null))).ok,false)
  assert.equal((await applyGuardedZoom({...options(t,bookTracker()),previousZoom:null})).ok,false)
  assert.equal(t.calls.length,0)
})
