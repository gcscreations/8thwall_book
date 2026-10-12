import {applyGuardedZoom} from './safe-zoom.js'

// Optional child-friendly camera controls for the browser stream owned by 8th Wall.
// Does not replace XR8's camera or modify the rendering projection.

const VALID_MODES = new Set(['kids', 'normal'])
const safeRead = (fn, fallback) => {
  try { return fn?.() ?? fallback } catch { return fallback }
}
const isRange = r => Number.isFinite(r?.min) && Number.isFinite(r?.max) && r.max >= r.min
const copyConstraints = c => ({
  ...(c || {}),
  ...(Array.isArray(c?.advanced) ? {advanced: c.advanced.map(x => ({...x}))} : {}),
})

export function createKidsCameraController({
  initialMode = 'kids',
  allowZoom = false,
  bookTracker = null,
  settleMs = 450,
  waitForSettle,
  onState = () => {},
} = {}) {
  if (!VALID_MODES.has(initialMode)) throw new Error('Mode must be kids or normal')
  let mode = initialMode
  let track = null
  let originalConstraints = {}
  let capabilities = {}
  let generation = 0
  let revision = 0
  let queue = Promise.resolve()
  let applied = false
  let videoReady = false
  let wantedZoom = null
  let baselineZoom = null
  let zoomBusy = false
  let focusState = 'device-managed'
  let zoomState = 'unchanged'
  let message = 'Waiting for rear camera'
  let disposed = false
  const subscribers = new Set([onState])

  const focusAvailable = () => Array.isArray(capabilities.focusMode) &&
    capabilities.focusMode.includes('continuous')
  const zoomAvailable = () => isRange(capabilities.zoom)
  const safeZoomAvailable = () => bookTracker &&
    typeof bookTracker.suspendPresentation === 'function' &&
    typeof bookTracker.resumePresentation === 'function' &&
    typeof bookTracker.confirmAlignment === 'function'
  const ready = () => !!track && track.readyState !== 'ended'
  const getState = () => {
    const settings = ready() ? safeRead(() => track.getSettings(), {}) : {}
    return {
      mode,
      ready: ready(),
      focusAvailable: ready() && focusAvailable(),
      focusState,
      actualFocus: settings.focusMode ?? null,
      zoomAvailable: ready() && zoomAvailable(),
      zoomEnabled: ready() && videoReady && allowZoom && zoomAvailable() && !!safeZoomAvailable(),
      zoomBusy,
      baselineZoom,
      alignmentState: safeRead(() => bookTracker?.getMetrics()?.presentationState, null),
      zoomMin: zoomAvailable() ? capabilities.zoom.min : null,
      zoomMax: zoomAvailable() ? capabilities.zoom.max : null,
      zoomStep: Number.isFinite(capabilities.zoom?.step) && capabilities.zoom.step > 0
        ? capabilities.zoom.step : 0.1,
      actualZoom: Number.isFinite(settings.zoom) ? settings.zoom : null,
      requestedZoom: wantedZoom,
      zoomState,
      message,
    }
  }
  const notify = () => {
    const state = getState()
    for (const cb of subscribers) {
      try { cb(state) } catch (err) { console.warn('[book-camera] UI subscriber failed', err) }
    }
    return state
  }

  // Invalidate pending asynchronous camera changes when the XR8 session is replaced.
  const release = () => {
    generation++
    revision++
    if (track?.removeEventListener) track.removeEventListener('ended', onEnded)
    track = null
    capabilities = {}
    originalConstraints = {}
    wantedZoom = null
    baselineZoom = null
    applied = false
    videoReady = false
    focusState = 'device-managed'
    zoomState = 'unchanged'
    message = 'Waiting for rear camera'
    if (safeZoomAvailable()) bookTracker.suspendPresentation('camera-restart')
    notify()
  }
  function onEnded() {
    release()
  }

  const applyMode = () => {
    const token = generation
    const currentRevision = ++revision
    const source = track
    const requestedMode = mode
    const zoom = wantedZoom
    const base = copyConstraints(originalConstraints)
    queue = queue.catch(() => {}).then(async () => {
      if (disposed || token !== generation || currentRevision !== revision ||
          !source || source.readyState === 'ended') return
      const continuous = requestedMode === 'kids' && focusAvailable()
      // Zoom is never reapplied as a side effect of autofocus/mode changes.
      if (requestedMode === 'kids' && Number.isFinite(zoom) &&
          Number.isFinite(baselineZoom) && Math.abs(zoom - baselineZoom) > 0.05) {
        message = 'Kids Mode zoom active; focus settings preserved'
        notify()
        return
      }
      if (!continuous && !applied) {
        message = requestedMode === 'kids' ? 'Using phone-managed autofocus' : 'Standard camera mode'
        focusState = 'device-managed'
        notify()
        return
      }
      if (typeof source.applyConstraints !== 'function') {
        message = 'Camera controls unavailable; tracking continues normally'
        focusState = 'device-managed'
        notify()
        return
      }
      const candidate = {...base}
      if (continuous) candidate.focusMode = 'continuous'
      try {
        await source.applyConstraints(candidate)
        if (disposed || token !== generation || currentRevision !== revision) return
        applied = true
        const settings = safeRead(() => source.getSettings(), {})
        focusState = continuous
          ? (settings.focusMode === 'continuous' ? 'confirmed' : 'requested-unverified')
          : 'device-managed'
        zoomState = wantedZoom !== null ? zoomState : 'unchanged'
        message = requestedMode === 'kids' ? 'Kids Mode: keep both pages visible' : 'Standard camera mode'
      } catch (err) {
        if (disposed || token !== generation || currentRevision !== revision) return
        focusState = 'device-managed'
        zoomState = wantedZoom !== null ? zoomState : 'unchanged'
        message = 'Camera did not accept the requested setting; standard camera still works'
      }
      notify()
    })
    return queue.then(() => getState())
  }

  const bindStream = (stream, {waitForVideo = false} = {}) => {
    if (disposed) return false
    const next = stream?.getVideoTracks?.().find(t => t.readyState !== 'ended')
    if (!next) return false
    if (next === track) {
      if (!waitForVideo && !videoReady) {
        videoReady = true
        void applyMode()
      }
      return true
    }
    release()
    track = next
    generation++
    capabilities = safeRead(() => next.getCapabilities(), {}) || {}
    originalConstraints = copyConstraints(safeRead(() => next.getConstraints(), {}))
    baselineZoom = safeRead(() => next.getSettings()?.zoom, null)
    if (!Number.isFinite(baselineZoom)) baselineZoom = null
    if (next.addEventListener) next.addEventListener('ended', onEnded)
    videoReady = !waitForVideo
    message = waitForVideo ? 'Waiting for camera preview' : 'Camera connected'
    notify()
    if (videoReady) void applyMode()
    return true
  }

  const setMode = next => {
    if (!VALID_MODES.has(next)) return Promise.reject(new Error('Mode must be kids or normal'))
    if (disposed) return Promise.reject(new Error('Controller disposed'))
    if (zoomBusy) return Promise.resolve({ok:false,reason:'Wait for zoom to finish'})
    const current = safeRead(() => track?.getSettings()?.zoom, null)
    if (next === 'normal' && Number.isFinite(baselineZoom) &&
        Number.isFinite(current) && Math.abs(current - baselineZoom) > 0.05) {
      message = 'Reset camera zoom before switching to Normal Mode'
      notify()
      return Promise.resolve({ok:false,reason:message})
    }
    mode = next
    notify()
    return ready() ? applyMode() : Promise.resolve(getState())
  }
  const setZoom = async value => {
    if (disposed) return {ok:false,reason:'Controller disposed'}
    if (!allowZoom) return {ok:false,reason:'Zoom is disabled until enabled by the application'}
    if (mode !== 'kids') return {ok:false,reason:'Switch to Kids Mode to adjust zoom'}
    if (!ready() || !videoReady || !zoomAvailable()) {
      return {ok:false,reason:'Camera zoom is not available on this device'}
    }
    if (!safeZoomAvailable()) {
      return {ok:false,reason:'Connect the book tracker to enable guarded zoom'}
    }
    if (zoomBusy) return {ok:false,reason:'Another zoom change is in progress'}
    const n=Number(value)
    if (!Number.isFinite(n) || n<capabilities.zoom.min || n>capabilities.zoom.max) {
      return {ok:false,reason:'Zoom is outside the camera-supported range'}
    }
    const source=track
    const epoch=generation
    const previousZoom=safeRead(()=>source.getSettings()?.zoom,null)
    if (!Number.isFinite(previousZoom) || !Number.isFinite(baselineZoom)) {
      return {ok:false,reason:'Camera zoom cannot be verified; use standard mode'}
    }
    zoomBusy=true
    message='Updating camera zoom; AR pages temporarily hidden'
    notify()
    try {
      // Serializes the zoom transaction after any outstanding focus request.
      await queue.catch(()=>{})
      if (epoch!==generation || source!==track || disposed) {
        return {ok:false,reason:'Camera stream changed before zoom'}
      }
      const result=await applyGuardedZoom({
        track:source,zoom:n,previousZoom,baselineZoom,
        bookTracker,settleMs,wait:waitForSettle,
        step:capabilities.zoom.step,
        isCurrent:()=>!disposed && epoch===generation && track===source,
      })
      if (epoch!==generation || source!==track || disposed) {
        return {ok:false,reason:'Camera stream changed during zoom'}
      }
      if (result.ok) {
        wantedZoom=n
        zoomState='confirmed'
        message=result.pendingAlignment
          ? 'Find both pages, then confirm the video edges align'
          : 'Zoom reset; reacquiring both pages'
      } else {
        zoomState=result.restartRequired?'restart-required':'failed'
        message=result.reason
      }
      notify()
      return {...result,state:getState()}
    } catch(err) {
      zoomState='failed'
      message=err?.message || 'Could not change zoom'
      notify()
      return {ok:false,reason:message}
    } finally {
      zoomBusy=false
      notify()
    }
  }
  const confirmAlignment=()=>{
    const ok=!!safeZoomAvailable() && bookTracker.confirmAlignment()
    message=ok?'Video alignment confirmed for this session':
      'Keep both pages visible until the alignment preview is available'
    notify()
    return ok
  }
  const pipelineModule = () => ({
    name: 'book-kids-camera',
    onCameraStatusChange({status,stream,video}) {
      if (status === 'hasStream') bindStream(stream, {waitForVideo:true})
      else if (status === 'hasVideo') {
        bindStream(video?.srcObject)
        if (safeZoomAvailable() && !zoomBusy &&
            bookTracker.getMetrics()?.presentationState === 'suspended') {
          bookTracker.resumePresentation({requireConfirmation:false})
        }
      }
      else if (status === 'requesting' || status === 'failed') release()
    },
    onSessionDetach: release,
    onDetach: release,
  })
  const subscribe = callback => {
    subscribers.add(callback)
    try { callback(getState()) } catch { /* UI callbacks are optional. */ }
    return () => subscribers.delete(callback)
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    release()
    subscribers.clear()
  }
  return {
    getState, setMode, setZoom, confirmAlignment, bindStream, pipelineModule, subscribe,
    whenIdle: () => queue,
    dispose,
  }
}
