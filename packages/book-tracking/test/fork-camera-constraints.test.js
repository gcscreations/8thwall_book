import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import * as moduleTools from 'node:module'

const sourceFile = new URL('../../../reality/app/xr/js/src/constraints-helper.ts', import.meta.url)

// Exercise the real fork TypeScript source without needing the Bazel/WASM engine.
const makeHarness = ({
  devices = [],
  os = 'Android',
  supportsDeviceId = true,
  manufacturer = 'Xiaomi',
} = {}) => {
  const raw = readFileSync(sourceFile, 'utf8')
  if (typeof moduleTools.stripTypeScriptTypes !== 'function') return null
  const body = moduleTools.stripTypeScriptTypes(raw)
    .replace(/^import(?: type)?[^\n]*\n/gm, '')
    .replace(/export\s*\{\s*getCameraConstraints,\s*hasResolutionIndex,\s*\}\s*$/, 
      'module.exports = {getCameraConstraints, hasResolutionIndex}')
  const requested = []
  const navigatorMock = {
    userAgent: 'Mozilla/5.0 Chrome',
    mediaDevices: {
      getSupportedConstraints: () => ({deviceId: supportsDeviceId}),
      enumerateDevices: async () => devices,
      getUserMedia: async (constraints) => {
        requested.push(constraints)
        return {getTracks: () => [{stop() {}}]}
      },
    },
  }
  const sandbox = {
    module: {exports: {}},
    navigator: navigatorMock,
    XrConfigFactory: () => ({camera: () => ({BACK: 'back', FRONT: 'front', ANY: 'any'})}),
    XrDeviceFactory: () => ({deviceEstimate: () => ({
      os, manufacturer, model: 'Redmi Note 13 5G',
      browser: {fullName: 'Mobile Chrome', majorVersion: 130},
    })}),
    Promise, Set,
  }
  runInNewContext(body, sandbox, {timeout: 1000})
  return {getCameraConstraints: sandbox.module.exports.getCameraConstraints, requested}
}

if (typeof moduleTools.stripTypeScriptTypes !== 'function') {
  test('fork source smoke checks need Node.js 22+', {skip: true}, () => {})
} else {
  const cameras = [
    {kind: 'videoinput', label: 'Front Camera', deviceId: 'front-id'},
    {kind: 'videoinput', label: 'Back Camera', deviceId: 'main-id'},
    {kind: 'videoinput', label: 'Back Ultra Wide Camera', deviceId: 'ultra-id'},
  ]

  test('fork camera config selects browser-advertised ultra-wide at getUserMedia startup', async () => {
    const h = makeHarness({devices: cameras})
    const result = await h.getCameraConstraints(0, {direction: 'back', preferUltraWide: true})
    assert.equal(result.video.deviceId.exact, 'ultra-id')
    assert.equal(result.video.facingMode.exact, 'environment')
  })

  test('fork camera config honors explicit device ID', async () => {
    const h = makeHarness({devices: cameras})
    const result = await h.getCameraConstraints(0, {direction: 'back', deviceId: 'main-id'})
    assert.equal(result.video.deviceId.exact, 'main-id')
  })

  test('unadvertised wide lens safely stays with ordinary rear camera', async () => {
    const h = makeHarness({devices: [
      {kind:'videoinput', label:'Back Camera', deviceId:'normal'},
      {kind:'videoinput', label:'Front Camera', deviceId:'front'},
    ]})
    const result = await h.getCameraConstraints(0, {direction: 'back', preferUltraWide:true})
    assert.equal(result.video.deviceId, undefined)
    assert.equal(result.video.facingMode.exact,'environment')
  })

  test('front ultra wide lens is never auto-selected as the rear lens', async () => {
    const h = makeHarness({devices: [
      {kind:'videoinput', label:'Front Ultra Wide Camera', deviceId:'front-wide'},
      {kind:'videoinput', label:'Back Camera', deviceId:'back'},
    ]})
    const result = await h.getCameraConstraints(0, {direction:'back', preferUltraWide:true})
    assert.equal(result.video.deviceId, undefined)
  })

  test('camera IDs never leak into the default XR session or later resolution retries', async () => {
    const h = makeHarness({devices:cameras})
    const chosen = await h.getCameraConstraints(0, {direction:'back', deviceId:'ultra-id'})
    const normal = await h.getCameraConstraints(0, {direction:'back'})
    assert.equal(chosen.video.deviceId.exact,'ultra-id')
    assert.equal(normal.video.deviceId,undefined)
  })

  test('iPhone accepts a selected lens ID without forcing front-facing mode', async () => {
    const h = makeHarness({devices:cameras, os:'iOS'})
    const chosen = await h.getCameraConstraints(0,{direction:'back',deviceId:'ultra-id'})
    assert.equal(chosen.video.deviceId.exact,'ultra-id')
    assert.equal(chosen.video.facingMode[0],'environment')
  })

  test('browser with no device ID support does not attempt ultra-wide selection', async () => {
    const h = makeHarness({devices:cameras,supportsDeviceId:false})
    const selected = await h.getCameraConstraints(0,{direction:'back',preferUltraWide:true})
    assert.equal(selected.video.deviceId,undefined)
  })
}
