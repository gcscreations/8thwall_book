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
  isBookTracked = () => false,
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
  let focusState = 'device-managed'
  let zoomState = 'unchanged'
  let message = 'Waiting for rear camera'
  let disposed = false
  const subscribers = new Set([onState])

  const focusAvailable = () => Array.isArray(capabilities.focusMode) &&
    capabilities.focusMode.includes('continuous')
  const zoomAvailable = () => isRange(capabilities.zoom)
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
      zoomEnabled: ready() && allowZoom && zoomAvailable(),
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
    applied = false
    videoReady = false
    focusState = 'device-managed'
    zoomState = 'unchanged'
    message = 'Waiting for rear camera'
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
      const useZoom = requestedMode === 'kids' && allowZoom && zoom !== null && zoomAvailable() &&
        zoom >= capabilities.zoom.min && zoom <= capabilities.zoom.max && !isBookTracked()
      if (!continuous && !useZoom && !applied) {
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
      if (useZoom) candidate.zoom = zoom
      try {
        await source.applyConstraints(candidate)
        if (disposed || token !== generation || currentRevision !== revision) return
        applied = true
        const settings = safeRead(() => source.getSettings(), {})
        focusState = continuous
          ? (settings.focusMode === 'continuous' ? 'confirmed' : 'requested-unverified')
          : 'device-managed'
        zoomState = useZoom
          ? (Number.isFinite(settings.zoom) && Math.abs(settings.zoom - zoom) < 0.05
            ? 'confirmed' : 'requested-unverified')
          : 'unchanged'
        message = requestedMode === 'kids' ? 'Kids Mode: keep both pages visible' : 'Standard camera mode'
      } catch (err) {
        if (disposed || token !== generation || currentRevision !== revision) return
        focusState = 'device-managed'
        zoomState = useZoom ? 'failed' : 'unchanged'
        message = 'Camera did not accept the requested setting; standard camera still works'
        // If a joint focus + zoom request failed, still try continuous focus alone.
        if (continuous && useZoom) {
          try {
            await source.applyConstraints({...base, focusMode: 'continuous'})
            if (disposed || token !== generation || currentRevision !== revision) return
            applied = true
            const settings = safeRead(() => source.getSettings(), {})
            focusState = settings.focusMode === 'continuous' ? 'confirmed' : 'requested-unverified'
            message = 'Zoom unavailable; continuous focus requested'
          } catch { /* Keep the original stream unchanged. */ }
        }
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
    if (wantedZoom !== null && (!zoomAvailable() || wantedZoom < capabilities.zoom.min ||
        wantedZoom > capabilities.zoom.max)) wantedZoom = null
    originalConstraints = copyConstraints(safeRead(() => next.getConstraints(), {}))
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
    mode = next
    notify()
    return ready() ? applyMode() : Promise.resolve(getState())
  }
  const setZoom = value => {
    if (disposed) return Promise.reject(new Error('Controller disposed'))
    if (!allowZoom) return Promise.resolve({ok:false,reason:'Zoom locked to preserve AR alignment'})
    if (mode !== 'kids') return Promise.resolve({ok:false,reason:'Switch to Kids Mode before adjusting zoom'})
    if (!ready() || !zoomAvailable()) {
      return Promise.resolve({ok:false,reason:'Camera zoom is not supported on this device'})
    }
    const n = Number(value)
    if (!Number.isFinite(n) || n < capabilities.zoom.min || n > capabilities.zoom.max) {
      return Promise.resolve({ok:false,reason:'Zoom outside camera-supported range'})
    }
    if (isBookTracked()) return Promise.resolve({ok:false,reason:'Move the book out of view before adjusting zoom'})
    wantedZoom = n
    notify()
    return applyMode().then(state => ({
      ok: state.zoomState === 'confirmed',
      ...(state.zoomState !== 'confirmed' ? {reason: 'Zoom could not be verified on this camera'} : {}),
      state,
    }))
  }
  const pipelineModule = () => ({
    name: 'book-kids-camera',
    onCameraStatusChange({status,stream,video}) {
      if (status === 'hasStream') bindStream(stream, {waitForVideo:true})
      else if (status === 'hasVideo') bindStream(video?.srcObject)
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
    getState, setMode, setZoom, bindStream, pipelineModule, subscribe,
    whenIdle: () => queue,
    dispose,
  }
}
