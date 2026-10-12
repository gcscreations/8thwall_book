# Kids Mode camera controls (Android and iPhone)

This extension configures the **existing 8th Wall camera stream**. It does not open a second camera or modify the AR projection matrix. It is meant for a child holding or rotating a printed two-page book close to a phone camera.

## Important hardware limitations

- Browsers generally do **not** let a website set the physical lens focal length. The browser may expose `focusMode` (e.g., continuous autofocus) or `zoom` through `MediaStreamTrack.getCapabilities()` and `applyConstraints()`.
- Many iPhones do **not** expose `focusMode` or ultrawide (< 1x) zoom through the browser camera API. The module then keeps device-managed autofocus and a standard view.
- The current 8th Wall session selects the rear camera. This module does not force a particular physical wide-angle lens or device ID.
- **Zoom is OFF by default** to protect image-target projection alignment. If you enable experimental zoom, verify AR alignment again on the actual phone before production use. The zoom slider is disabled while either page is tracked.
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

## Optional zoom (experimental)

```js
const kidsCamera = createKidsCameraController({
  initialMode: 'kids',
  allowZoom: true, // explicitly opt into AR-geometry-sensitive controls
  isBookTracked: () => {
    const m = bookTracker.getMetrics()
    return m.leftTracked || m.rightTracked
  },
})
```

The UI automatically hides the zoom slider if the camera doesn't expose a valid zoom range. It does **not** claim that 0.5x/0.7x is available on all Android phones or iPhones. `getSettings().zoom` is used to confirm whether the camera actually applied the request; otherwise the operation is marked unverified. Prefer the default 1x lens for real book tracking until the zoom-specific calibration is tested.

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
