export {createKidsCameraController} from './kids-camera.js'
export {mountKidsCameraControls} from './kids-camera-ui.js'

import {foldAngles,fullPageGeometry,spinePoint,length,subtract} from './math.js'
export {foldAngles,fullPageGeometry,spinePoint,rotateVector} from './math.js'

const lerp = (a,b,t) => a+(b-a)*t

/**
 * Render two independently tracked rigid pages with ONE video texture.
 * Does not infer separate page poses from a single image target.
 */
export function createPhysicalBookTracker({
  THREE,scene,video,
  targetNames={left:'page-left',right:'page-right'},
  smoothingMs=60,
  seamCorrectionStrength=0.25,
  maxSeamGapRatio=0.12,
  maxReacquireGapRatio=0.08,
  minReacquireSamplesPerPage=3,
  previewOpacity=0.55,
  surfaceOffset=0.002,
  onMetrics=()=>{},
}={}) {
  if (!THREE || !scene || !video) throw new Error('THREE, scene and video are required')
  if (!Number.isInteger(minReacquireSamplesPerPage) || minReacquireSamplesPerPage < 1 ||
      !Number.isFinite(maxReacquireGapRatio) || maxReacquireGapRatio <= 0) {
    throw new Error('Invalid reacquisition requirements')
  }
  if (!targetNames.left || !targetNames.right || targetNames.left===targetNames.right) {
    throw new Error('Target names must be distinct')
  }
  video.setAttribute('playsinline','')
  video.setAttribute('webkit-playsinline','')
  const texture = new THREE.VideoTexture(video)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace

  const makePage = (side,name) => {
    const root = new THREE.Group()
    root.name = 'book-'+side+'-target'
    root.visible = false
    scene.add(root)
    const geometry = new THREE.PlaneGeometry(1,1)
    const uvs = geometry.getAttribute('uv')
    for (let i=0;i<uvs.count;i++) {
      uvs.setX(i, (uvs.getX(i)+(side==='right'?1:0))/2)
    }
    uvs.needsUpdate = true
    const material = new THREE.MeshBasicMaterial({
      map:texture, side:THREE.DoubleSide, toneMapped:false,
      transparent:true, opacity:1,
    })
    const mesh = new THREE.Mesh(geometry,material)
    mesh.name = 'book-'+side+'-video-half'
    root.add(mesh)
    return {
      side,name,root,mesh,active:false,
      goalPosition:new THREE.Vector3(),
      smoothPosition:new THREE.Vector3(),
      goalQuaternion:new THREE.Quaternion(),
      smoothQuaternion:new THREE.Quaternion(),
      goalRect:null,
      smoothRect:null,
    }
  }

  const pages = {
    left:makePage('left',targetNames.left),
    right:makePage('right',targetNames.right),
  }
  let lastUpdateMs = null
  let presentationState = 'ready'
  let confirmationRequired = false
  let reacquireSamples = {left:0,right:0}
  let metrics = {
    leftTracked:false,rightTracked:false,
    bendDegrees:null,signedBendDegrees:null,openingDegrees:null,seamGap:null,
    seamGapRatio:null,presentationState:'ready',alignmentStatus:'unverified',
  }

  const resetPagePoses = () => {
    for (const page of Object.values(pages)) {
      page.active=false
      page.root.visible=false
      page.goalRect=null
      page.smoothRect=null
    }
    reacquireSamples={left:0,right:0}
    lastUpdateMs=null
  }
  // Invalidates previously acquired poses. The underlying XR8 engine still
  // runs, but our page overlays ignore pose updates during camera changes.
  const suspendPresentation = (reason='camera-change') => {
    presentationState='suspended'
    confirmationRequired=false
    resetPagePoses()
    for (const page of Object.values(pages)) page.mesh.material.opacity=1
    metrics={...metrics,leftTracked:false,rightTracked:false,bendDegrees:null,
      openingDegrees:null,signedBendDegrees:null,seamGap:null,seamGapRatio:null,
      presentationState,alignmentStatus:'paused',suspendReason:reason}
    onMetrics({...metrics})
  }
  const resumePresentation = ({requireConfirmation=true}={}) => {
    resetPagePoses()
    confirmationRequired=!!requireConfirmation
    presentationState='reacquiring'
    metrics={...metrics,leftTracked:false,rightTracked:false,bendDegrees:null,
      openingDegrees:null,signedBendDegrees:null,seamGap:null,seamGapRatio:null,
      presentationState,alignmentStatus:'waiting-targets'}
    onMetrics({...metrics})
  }
  const confirmAlignment = () => {
    if (presentationState!=='needs-confirmation' ||
        !pages.left.active || !pages.right.active ||
        !Number.isFinite(metrics.seamGapRatio) ||
        metrics.seamGapRatio>maxReacquireGapRatio) return false
    presentationState='ready'
    confirmationRequired=false
    pages.left.mesh.material.opacity=1
    pages.right.mesh.material.opacity=1
    metrics={...metrics,presentationState,alignmentStatus:'user-confirmed'}
    onMetrics({...metrics})
    return true
  }
  const pageByName = name => Object.values(pages).find(p=>p.name===name)

  // Takes an 8th Wall pose event or the event detail directly.
  const onPose = event => {
    if (presentationState==='suspended') return false
    const data = event?.detail || event
    if (!data || typeof data.name!=='string' || !data.position || !data.rotation) return false
    const page = pageByName(data.name)
    if (!page) return false
    const numbers = [data.position.x,data.position.y,data.position.z,
      data.rotation.x,data.rotation.y,data.rotation.z,data.rotation.w,
      data.scaledWidth,data.scaledHeight,data.scale]
    if (numbers.some(n=>!Number.isFinite(n))) return false
    let rect
    try {
      rect = fullPageGeometry({
        scaledWidth:data.scaledWidth,scaledHeight:data.scaledHeight,
        scale:data.scale,properties:data.properties || {},
      })
    } catch (err) {
      console.warn('[book-tracking] Invalid target crop:',err.message)
      return false
    }
    page.goalPosition.set(data.position.x,data.position.y,data.position.z)
    page.goalQuaternion.set(data.rotation.x,data.rotation.y,data.rotation.z,data.rotation.w).normalize()
    page.goalRect = rect
    if (!page.active) {
      page.smoothPosition.copy(page.goalPosition)
      page.smoothQuaternion.copy(page.goalQuaternion)
      page.smoothRect = {...rect}
    }
    page.active = true
    if (presentationState==='reacquiring') reacquireSamples[page.side]++
    page.root.visible = presentationState==='ready' ||
      presentationState==='needs-confirmation'
    return true
  }

  const onLost = event => {
    const name=(event?.detail||event)?.name
    const page=pageByName(name)
    if (!page) return false
    page.active=false
    page.root.visible=false
    if (presentationState==='reacquiring' || presentationState==='needs-confirmation') {
      presentationState='reacquiring'
      reacquireSamples[page.side]=0
    }
    return true
  }

  const update = (timeMs=performance.now()) => {
    const dt = lastUpdateMs===null ? 16.7 : Math.min(200,Math.max(0,timeMs-lastUpdateMs))
    lastUpdateMs=timeMs
    const alpha=smoothingMs<=0?1:1-Math.exp(-dt/smoothingMs)
    for (const page of Object.values(pages)) {
      if (!page.active || !page.goalRect) continue
      page.smoothPosition.lerp(page.goalPosition,alpha)
      page.smoothQuaternion.slerp(page.goalQuaternion,alpha)
      for(const k of ['width','height','offsetX','offsetY']){
        page.smoothRect[k]=lerp(page.smoothRect[k],page.goalRect[k],alpha)
      }
      page.root.position.copy(page.smoothPosition)
      page.root.quaternion.copy(page.smoothQuaternion)
      page.mesh.position.set(page.smoothRect.offsetX,page.smoothRect.offsetY,surfaceOffset)
      page.mesh.scale.set(page.smoothRect.width,page.smoothRect.height,1)
    }
    metrics={
      leftTracked:pages.left.active,rightTracked:pages.right.active,
      bendDegrees:null,signedBendDegrees:null,openingDegrees:null,seamGap:null,
      seamGapRatio:null,presentationState,
      alignmentStatus:presentationState==='suspended'?'paused':'waiting-targets',
    }
    if (pages.left.active && pages.right.active) {
      const leftPose={position:pages.left.smoothPosition,rotation:pages.left.smoothQuaternion}
      const rightPose={position:pages.right.smoothPosition,rotation:pages.right.smoothQuaternion}
      const a=spinePoint(leftPose,pages.left.smoothRect,'left')
      const b=spinePoint(rightPose,pages.right.smoothRect,'right')
      const delta=subtract(b,a)
      const gap=length(delta)
      metrics.seamGap=gap
      const minWidth=Math.min(pages.left.smoothRect.width,pages.right.smoothRect.width)
      metrics.seamGapRatio=minWidth>0?gap/minWidth:null
      Object.assign(metrics,foldAngles(leftPose.rotation,rightPose.rotation))
      const pageWidth=minWidth
      const strength=Math.max(0,Math.min(1,seamCorrectionStrength))
      if(gap<=pageWidth*maxSeamGapRatio && strength>0){
        pages.left.root.position.addScaledVector(
          new THREE.Vector3(delta.x,delta.y,delta.z),strength/2
        )
        pages.right.root.position.addScaledVector(
          new THREE.Vector3(delta.x,delta.y,delta.z),-strength/2
        )
      }
    }
    if (presentationState==='needs-confirmation' &&
        (!pages.left.active || !pages.right.active ||
          !Number.isFinite(metrics.seamGapRatio) ||
          metrics.seamGapRatio>maxReacquireGapRatio)) {
      presentationState='reacquiring'
      reacquireSamples={left:0,right:0}
    }
    if (presentationState==='reacquiring') {
      const bothFresh=pages.left.active && pages.right.active &&
        reacquireSamples.left>=minReacquireSamplesPerPage &&
        reacquireSamples.right>=minReacquireSamplesPerPage
      if (bothFresh && Number.isFinite(metrics.seamGapRatio) &&
          metrics.seamGapRatio<=maxReacquireGapRatio) {
        presentationState=confirmationRequired?'needs-confirmation':'ready'
      } else {
        metrics.alignmentStatus=bothFresh?'spine-misaligned':'waiting-targets'
      }
    }
    if (presentationState==='needs-confirmation') {
      metrics.alignmentStatus='visual-confirmation-needed'
    } else if (presentationState==='ready') {
      metrics.alignmentStatus='geometry-accepted'
    }
    metrics.presentationState=presentationState
    for (const page of Object.values(pages)) {
      page.root.visible=page.active && (presentationState==='ready' ||
        presentationState==='needs-confirmation')
      page.mesh.material.opacity=presentationState==='needs-confirmation'?previewOpacity:1
    }
    onMetrics({...metrics})
    return {...metrics}
  }

  const pipelineModule=()=>({
    name:'physical-book-tracker',
    listeners:[
      {event:'reality.imagefound',process:e=>{onPose(e)}},
      {event:'reality.imageupdated',process:e=>{onPose(e)}},
      {event:'reality.imagelost',process:e=>{onLost(e)}},
    ],
    onUpdate:()=>{update()},
  })

  const dispose=()=>{
    for(const page of Object.values(pages)){
      scene.remove(page.root)
      page.mesh.geometry.dispose()
      page.mesh.material.dispose()
      page.active=false
    }
    texture.dispose()
  }

  return {
    onPose,onLost,update,pipelineModule,
    getMetrics:()=>({...metrics}),
    getPageObjects:()=>({left:pages.left.root,right:pages.right.root}),
    videoTexture:texture,
    suspendPresentation,resumePresentation,confirmAlignment,
    dispose,
  }
}
