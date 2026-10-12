# Two-target Physical Book AR Extension

This self-contained module extends 8th Wall's **existing image target pose events**, and does not alter the C++/WASM recognition engine, proprietary SLAM binary, or existing engine files.

It provides:

- One individually tracked image target per movable printed page.
- Two 3D page surfaces with ONE HTMLVideoElement and ONE THREE.VideoTexture.
- Video UV mapping: left page shows U=0..0.5; right shows U=0.5..1.
- A physical fold-angle estimate, when **both** pages are detected simultaneously.
- Full-page rendering coordinates from centered or offset (upright) image-target crops.
- Independent target-loss handling, smoothing, and conservative spine-gap correction.

## Prepare the printed book

For a 2048×1152 complete artwork, split vertically at x=1024 into two 1024×1152 images. Print the pages separately at equal physical dimensions with their inner edges joined.

Generate a **separate PLANAR image target** for each printed page with the [8th Wall CLI](https://github.com/8thwall/8thwall/tree/main/apps/image-target-cli):

    npx @8thwall/image-target-cli@latest

Use names `page-left` and `page-right`, upright crops, `moveable: true`, and matching physical dimensions. The original artwork and the sample MP4 are intentionally not committed to this public repository.

## Add to your existing project

Use the same Three.js instance as your 8th Wall renderer. Load the engine and the two generated target JSON files before starting your camera.

```js
import {createPhysicalBookTracker} from './packages/book-tracking/src/index.js'

const video = document.querySelector('#book-video')
const tracker = createPhysicalBookTracker({
  THREE, scene: XR8.Threejs.xrScene().scene, video,
  targetNames: {left: 'page-left', right: 'page-right'},
  onMetrics: (m) => {
    console.log(m.leftTracked, m.rightTracked, m.bendDegrees)
  },
})

XR8.XrController.configure({
  disableWorldTracking: true,
  imageTargetData: [leftTargetJson, rightTargetJson],
})
XR8.addCameraPipelineModule(tracker.pipelineModule())

// In a phone user-gesture event:
startButton.addEventListener('click', async () => {
  await video.play() // muted video recommended for automatic playback
  XR8.run({canvas: document.querySelector('#camera-canvas')})
})
```

Provide **one** HTML video element, containing one full-spread landscape video:

```html
<video id="book-video" src="assets/book.mp4" muted loop playsinline></video>
```

Register the pipeline module before starting the XR session. If you already use `XR8.Threejs.pipelineModule()` and `XR8.XrController.pipelineModule()`, keep those existing modules and append `tracker.pipelineModule()`; do not register duplicates. `tracker.dispose()` removes the meshes and releases the texture.

## Tests

Run `cd packages/book-tracking && npm test` (Node 18+). Tests cover fold angles, crop mapping, page spines, UVs, shared textures, and target loss.

## Limits

- The framework cannot infer independent page poses from **one** planar target. Two simultaneous detections are required for a fold angle.
- Flat rigid pages can be tracked; **paper curling** is not tracked.
- Fold-angle output becomes `null` when either target is lost.
- The angle estimate and video alignment need **phone camera testing** with the actual printed book.
- The default seam correction is mild and does not forcibly join inconsistent target observations.
- Only upright crop metadata is currently supported.

See the full local demo in the separately distributed ZIP if you need printable sample artwork and an MP4. Those binary assets are not included in the public GitHub feature branch.

## Kids Mode camera support (Android and iPhone)

Add child-friendly **Kids Mode** controls for the camera stream already opened by 8th Wall. The extension requests continuous autofocus only on cameras that advertise support, includes large touch controls and two-page framing prompts, and safely falls back to phone-managed autofocus. Camera zoom is opt-in and off by default to avoid AR projection mismatch.

See [KIDS_MODE.md](./KIDS_MODE.md) for complete integration examples, Safari/Chrome limitations, and test procedures. The core book tracker is unchanged; import `createKidsCameraController` and `mountKidsCameraControls` from this package and include `src/kids-camera.css` in your app.
