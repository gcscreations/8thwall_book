# Kids Mode camera controls (Android and iPhone)

This extension configures the **existing 8th Wall camera stream**. It does not open a second camera or modify the AR projection matrix. It is meant for a child holding or rotating a printed two-page book close to a phone camera.

## Important hardware limitations

- Browsers generally do **not** let a website set the physical lens focal length. The browser may expose `focusMode` (e.g., continuous autofocus) or `zoom` through `MediaStreamTrack.getCapabilities()` and `applyConstraints()`.
- Many iPhones do **not** expose `focusMode` or ultrawide (< 1x) zoom through the browser camera API. The module then keeps device-managed autofocus and a standard view.
- The current 8th Wall session selects the rear camera. This module does not force a particular physical wide-angle lens or device ID.
- **Zoom remains opt-in**: when enabled, changes suspend the AR page overlays and require fresh target poses, spine consistency and a visual check. No browser option can guarantee projection calibration after zoom.
- Testing both phones is still required; unit tests with mocked tracks cannot prove image-target alignment, autofocus behavior, or real phone compatibility.

## Setup

1. Load the 8th Wall engine, and your two `page-left` / `page-right` image targets as described in `README.md`.
2. Add your book tracker and this camera module to the XR8 pipeline **before `XR8.run()`**.
3. Add `<div id="book-camera-controls"></div>` to your HTML. Keep the UI overlay clear of the main page view.
4. Include `packages/book-tracking/src/kids-camera.css` as a stylesheet (or bundle/copy it into your site).
5. Only use `allowZoom: true` after testing each camera/browser combination for AR pose accuracy.

```js
import {
  createPhysicalBookTracker,
  createKidsCameraController,
  mountKidsCameraControls,
} from './packages/book-tracking/src/index.js'

// Create the book tracker using the existing scene, one HTML video and target config.
let kidsControls
const bookTracker = createPhysicalBookTracker({
  THREE,
  scene,     // scene used by the 8th Wall Three.js renderer
  video: document.querySelector('#book-video'),
  targetNames: {left:'page-left',right:'page-right'},
  onMetrics: metrics => kidsControls?.updateTracking(metrics),
})

const kidsCamera = createKidsCameraController({
  initialMode: 'kids',
  allowZoom: false, // default: optical/digital zoom NOT requested
  isBookTracked: () => {
    const state = bookTracker.getMetrics()
    return state.leftTracked || state.rightTracked
  },
})

XR8.addCameraPipelineModule(kidsCamera.pipelineModule())
XR8.addCameraPipelineModule(bookTracker.pipelineModule())

kidsControls = mountKidsCameraControls({
  controller: kidsCamera,
  container: '#book-camera-controls',
})

// Then start XR8 in your existing user-gesture handler.
// Keep XR8's other essential camera/rendering pipeline modules intact.
```

When the user clicks `Kids Mode`, continuous autofocus is **requested** only if the current camera track reports that capability. `Normal` restores the stream's original constraints. A failure never stops the stream; the app continues using phone-managed focus.

## Guarded zoom (experimental and opt-in)

Kids Mode can now accept supported zoom changes **even while the book is in view**. Both AR video overlays are hidden, old target poses are invalidated, and the same camera stream is adjusted. This does not call XR8.pause() or open a second camera.

To enable in your existing book application:

```js
const kidsCamera = createKidsCameraController({
  initialMode: 'kids',
  allowZoom: true, // explicit project-level opt-in
  bookTracker,      // REQUIRED for suspension and verification
  settleMs: 450,
})
```

1. The camera must report `getCapabilities().zoom` and a verifiable starting `getSettings().zoom`. Not all Android phones or iPhones expose these browser controls.
2. Before changing zoom, the book tracker suppresses pose updates and hides both video meshes.
3. The zoom request uses `MediaStreamTrack.applyConstraints()` on the same stream. Its reported setting must match; otherwise the system attempts a verified rollback. If rollback cannot be verified, overlays stay hidden and a camera restart is required.
4. After the camera settles, the tracker demands at least **three fresh pose updates per page** and a sufficiently small center-spine gap before showing a semi-transparent video preview.
5. An adult/tester compares the actual page edges and spine against the preview and taps **Looks aligned**. If incorrect, use **Reset zoom**. Resetting to the session's original zoom reacquires both pages without another manual confirmation.
6. Normal Mode cannot be selected at non-default zoom: reset first to prevent an unguarded camera change.

**Important:** The spine check measures geometric agreement **between the two tracked pages**, not calibration of the camera projection. Correct projection and visual alignment at non-default zoom cannot be proven from browser zoom settings or unit tests. Test on each physical device/browser and keep this PR in draft until validated.

The interface automatically hides the zoom slider when unsupported; it does not promise a 0.5x/0.7x physical wide-angle lens. Continuous focus is requested when supported and phone-managed autofocus is used otherwise. The two page meshes continue sharing a single `THREE.VideoTexture`.

## Recommended test matrix

| Device/browser | What to verify |
|---|---|
| Android Chrome | Both pages acquire, focus remains sharp during folding, no video seam drift, optional zoom if exposed |
| iPhone Safari | Rear camera starts, continuous focus is requested only if exposed, browser-managed fallback works, video remains aligned |
| Both | Start/stop/restart camera, portrait/landscape, glare, close/far views, one target lost, user switches Normal/Kids Mode |

## Commands

```sh
cd packages/book-tracking
npm test
```

For best results, guide children to hold the entire book comfortably inside the frame, avoid glare, and move the phone back slightly rather than forcing ultrawide zoom. Use larger controls and no unexpected camera lens switching.
