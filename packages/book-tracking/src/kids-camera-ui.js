/** Touch-friendly camera controls; UI does not open an additional camera stream. */
export function mountKidsCameraControls({controller, container, documentRef = document} = {}) {
  if (!controller || !container) throw new Error('Controller and container are required')
  const mount = typeof container === 'string' ? documentRef.querySelector(container) : container
  if (!mount) throw new Error('Camera control mount element not found')
  const root = documentRef.createElement('section')
  root.className = 'book-camera-controls'
  root.setAttribute('aria-label', 'AR book camera settings')
  root.innerHTML = `
    <h2>Book Camera</h2>
    <div class="book-camera-modes" role="group" aria-label="Camera mode">
      <button type="button" data-mode="kids">Kids Mode</button>
      <button type="button" data-mode="normal">Normal</button>
    </div>
    <p class="book-camera-feedback" role="status" aria-live="polite"></p>
    <p class="book-camera-focus"></p>
    <div class="book-camera-zoom" hidden>
      <label>Zoom <output>1.0x</output>
        <input type="range" aria-label="Camera zoom" />
      </label>
      <p>Changing zoom can affect AR alignment. Set it before scanning.</p>
    </div>
    <p class="book-camera-guide" aria-live="polite">Point the rear camera at the open book.</p>`
  const buttons = Array.from(root.querySelectorAll('[data-mode]'))
  const feedback = root.querySelector('.book-camera-feedback')
  const focus = root.querySelector('.book-camera-focus')
  const zoomBox = root.querySelector('.book-camera-zoom')
  const zoomSlider = root.querySelector('[type="range"]')
  const zoomOutput = root.querySelector('output')
  const guide = root.querySelector('.book-camera-guide')
  let currentlyTracking = false
  const render = state => {
    buttons.forEach(b => {
      const selected = b.dataset.mode === state.mode
      b.setAttribute('aria-pressed', String(selected))
    })
    feedback.textContent = state.message
    focus.textContent = state.focusAvailable
      ? (state.focusState === 'confirmed' ? 'Continuous autofocus active' :
        state.focusState === 'requested-unverified' ? 'Continuous autofocus requested' :
          'Autofocus managed by the phone')
      : 'Focus managed automatically by the phone'
    zoomBox.hidden = !state.zoomEnabled
    if (state.zoomEnabled) {
      zoomSlider.min = state.zoomMin
      zoomSlider.max = state.zoomMax
      zoomSlider.step = state.zoomStep
      zoomSlider.value = state.requestedZoom ?? state.actualZoom ?? 1
      zoomSlider.disabled = currentlyTracking || state.mode !== 'kids'
      zoomOutput.textContent = `${Number(zoomSlider.value).toFixed(1)}x`
    }
  }
  const onMode = event => { void controller.setMode(event.currentTarget.dataset.mode) }
  buttons.forEach(b => b.addEventListener('click', onMode))
  const onZoom = () => { void controller.setZoom(zoomSlider.value).then(() => render(controller.getState())) }
  zoomSlider.addEventListener('change', onZoom)
  mount.appendChild(root)
  const unsubscribe = controller.subscribe(render)
  const updateTracking = metrics => {
    currentlyTracking = !!(metrics?.leftTracked || metrics?.rightTracked)
    if (metrics?.leftTracked && metrics?.rightTracked) guide.textContent = 'Great! Keep both pages visible.'
    else if (currentlyTracking) guide.textContent = 'Show both pages to follow the real fold.'
    else guide.textContent = 'Hold the phone steady, with the whole open book inside the frame.'
    render(controller.getState())
  }
  const destroy = () => {
    unsubscribe()
    buttons.forEach(b => b.removeEventListener('click', onMode))
    zoomSlider.removeEventListener('change', onZoom)
    root.remove()
  }
  return {element: root, updateTracking, destroy}
}
