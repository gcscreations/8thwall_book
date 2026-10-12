/**
 * Guarded zoom transaction for the existing 8th Wall camera stream.
 * Pauses book AR pose consumption (not the underlying XR8 camera pipeline).
 * This does not guarantee a correct new camera projection calibration.
 */
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const safeGet=(fn,fallback)=>{try{return fn()??fallback}catch{return fallback}}
const valid=n=>typeof n==='number'&&Number.isFinite(n)
const near=(a,b,t)=>valid(a)&&Math.abs(a-b)<=t

export async function applyGuardedZoom({
  track,zoom,previousZoom,baselineZoom=previousZoom,bookTracker,
  settleMs=450,wait=sleep,isCurrent=()=>true,step=0.1,
}={}) {
  const guard=bookTracker &&
    typeof bookTracker.suspendPresentation==='function' &&
    typeof bookTracker.resumePresentation==='function' &&
    typeof bookTracker.confirmAlignment==='function'
  if (!guard) return {ok:false,reason:'A book tracker with zoom safety support is required'}
  if (!track || typeof track.applyConstraints!=='function' || track.readyState==='ended') {
    return {ok:false,reason:'The camera is not ready'}
  }
  if (![zoom,previousZoom,baselineZoom].every(valid)) {
    return {ok:false,reason:'Camera does not report a verifiable initial zoom'}
  }
  const tolerance=Math.max(0.05,Math.min(0.25,(Number(step)||0.1)/2+0.005))
  if (near(previousZoom,zoom,tolerance)) {
    return {ok:true,unchanged:true,pendingAlignment:!near(zoom,baselineZoom,tolerance) &&
      bookTracker.getMetrics?.().presentationState!=='ready'}
  }
  bookTracker.suspendPresentation('camera-zoom')
  const applyValue=async value=>{
    const constraints=safeGet(()=>track.getConstraints(),{})
    await track.applyConstraints({...constraints,zoom:value})
    const reported=safeGet(()=>track.getSettings().zoom,null)
    if (!near(reported,value,tolerance)) {
      throw new Error('Camera did not confirm the requested zoom')
    }
  }
  const stillCurrent=()=>isCurrent()&&track.readyState!=='ended'
  try {
    await applyValue(zoom)
    if (!stillCurrent()) return {ok:false,reason:'Camera stream changed during zoom'}
    await wait(settleMs)
    if (!stillCurrent()) return {ok:false,reason:'Camera stream changed during zoom'}
    const pendingAlignment=!near(zoom,baselineZoom,tolerance)
    bookTracker.resumePresentation({requireConfirmation:pendingAlignment})
    return {ok:true,appliedZoom:zoom,pendingAlignment}
  } catch (err) {
    if (!stillCurrent()) return {ok:false,reason:'Camera changed; waiting for a new session'}
    try {
      await applyValue(previousZoom)
      if (!stillCurrent()) return {ok:false,reason:'Camera changed during rollback'}
      await wait(settleMs)
      if (!stillCurrent()) return {ok:false,reason:'Camera changed during rollback'}
      bookTracker.resumePresentation({
        requireConfirmation:!near(previousZoom,baselineZoom,tolerance)
      })
      return {ok:false,rolledBack:true,reason:err?.message||'Zoom was rejected'}
    } catch {
      return {ok:false,restartRequired:true,
        reason:'Zoom/rollback could not be verified. Restart the camera to restore AR alignment.'}
    }
  }
}
