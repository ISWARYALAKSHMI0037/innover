import { useEffect, useRef, useState } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { getExpression } from './expression'

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm'
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

function App() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const landmarkerRef = useRef(null)
  const streamRef = useRef(null)
  const animationRef = useRef(null)
  const sessionRef = useRef(0)
  const expressionKeyRef = useRef('')
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [status, setStatus] = useState('Camera is off')
  const [error, setError] = useState('')
  const [faceCount, setFaceCount] = useState(0)
  const [expressions, setExpressions] = useState([])

  const releaseCameraResources = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    animationRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    landmarkerRef.current?.close()
    landmarkerRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  const stopCamera = () => {
    sessionRef.current += 1
    releaseCameraResources()
    setRunning(false)
    setStarting(false)
    setFaceCount(0)
    setExpressions([])
    expressionKeyRef.current = ''
    setStatus('Camera is off')
  }

  const startCamera = async () => {
    const session = sessionRef.current + 1
    sessionRef.current = session
    setStarting(true)
    setError('')
    setStatus('Loading the on-device face model…')
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser does not support webcam access.')
      }
      const vision = await FilesetResolver.forVisionTasks(WASM_URL)
      const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: 'VIDEO',
        numFaces: 6,
        outputFaceBlendshapes: true,
      })
      if (session !== sessionRef.current) {
        landmarker.close()
        return
      }
      landmarkerRef.current = landmarker
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 960, height: 720 },
        audio: false,
      })
      if (session !== sessionRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      const video = videoRef.current
      if (!video) throw new Error('The video preview is unavailable.')
      video.srcObject = stream
      await video.play()
      if (session !== sessionRef.current) return
      setRunning(true)
      setStarting(false)
      setStatus('Looking for faces…')

      const drawFrame = () => {
        if (session !== sessionRef.current) return
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')
        const currentLandmarker = landmarkerRef.current
        if (!videoRef.current || !canvas || !context || !currentLandmarker) return

        const currentVideo = videoRef.current
        if (currentVideo.readyState >= 2) {
          canvas.width = currentVideo.videoWidth || 960
          canvas.height = currentVideo.videoHeight || 720
          context.drawImage(currentVideo, 0, 0, canvas.width, canvas.height)
          const result = currentLandmarker.detectForVideo(currentVideo, performance.now())
          const faces = result.faceLandmarks || []
          const visibleExpressions = faces.map((_, index) =>
            getExpression(result.faceBlendshapes?.[index]?.categories || [])
          )
          setFaceCount(faces.length)
          const expressionKey = visibleExpressions
            .map(({ label, tone }) => `${label}:${tone}`)
            .join('|')
          if (expressionKey !== expressionKeyRef.current) {
            expressionKeyRef.current = expressionKey
            setExpressions(visibleExpressions)
          }
          setStatus(faces.length ? `${faces.length} face${faces.length === 1 ? '' : 's'} in view` : 'Looking for faces…')

          for (let index = 0; index < faces.length; index += 1) {
            const points = faces[index]
            const xs = points.map(({ x }) => x * canvas.width)
            const ys = points.map(({ y }) => y * canvas.height)
            const minX = Math.min(...xs)
            const maxX = Math.max(...xs)
            const minY = Math.min(...ys)
            const maxY = Math.max(...ys)
            const expression = visibleExpressions[index]
            context.strokeStyle = expression.tone === 'positive' ? '#5be0ba' : '#a8b5ff'
            context.lineWidth = 3
            context.strokeRect(minX, minY, maxX - minX, maxY - minY)
            context.fillStyle = 'rgba(12, 18, 35, 0.88)'
            context.fillRect(minX, Math.max(0, minY - 34), Math.min(maxX - minX, 260), 30)
            context.fillStyle = '#f4f6ff'
            context.font = '600 15px system-ui'
            context.fillText(`Person ${index + 1}: ${expression.label}`, minX + 8, Math.max(20, minY - 14))
          }
        }
        animationRef.current = requestAnimationFrame(drawFrame)
      }
      drawFrame()
    } catch (caughtError) {
      if (session !== sessionRef.current) return
      stopCamera()
      const message = caughtError instanceof Error ? caughtError.message : 'Unable to start face detection.'
      setError(message)
      setStatus('Camera unavailable')
    }
  }

  useEffect(() => {
    const stopOnPageHide = () => {
      sessionRef.current += 1
      releaseCameraResources()
      setRunning(false)
      setStarting(false)
      setFaceCount(0)
      setExpressions([])
      setStatus('Camera is off')
      navigator.sendBeacon(
        'http://127.0.0.1:4170/api/stop/emotionStudio',
        new Blob([], { type: 'text/plain' })
      )
    }
    window.addEventListener('pagehide', stopOnPageHide)
    return () => {
      window.removeEventListener('pagehide', stopOnPageHide)
      sessionRef.current += 1
      releaseCameraResources()
    }
  }, [])

  return (
    <main className="shell">
      <header className="header">
        <div className="brand-mark" aria-hidden="true">✳</div>
        <div>
          <p className="eyebrow">Local vision demo</p>
          <h1>Expression Studio</h1>
        </div>
        <span className={`live-pill${running ? ' active' : ''}`}><i />{status}</span>
      </header>

      <section className="intro">
        <div>
          <p className="eyebrow">A little more human</p>
          <h2>Expressions, <span>in the moment.</span></h2>
          <p>See simple, visible facial-expression cues for up to six people at once.</p>
        </div>
        <button type="button" className={running || starting ? 'stop-button' : 'start-button'} onClick={running || starting ? stopCamera : startCamera}>
          {starting ? 'Cancel startup' : running ? 'Stop camera' : 'Start camera'}
        </button>
      </section>

      {error && <p className="error-banner" role="alert">{error}</p>}

      <section className="workspace">
        <div className="video-panel">
          <div className={`video-frame${running ? ' is-active' : ''}`}>
            <video ref={videoRef} autoPlay playsInline muted />
            <canvas ref={canvasRef} />
            {!running && (
              <div className="camera-placeholder">
                <span aria-hidden="true">◎</span>
                <strong>Your camera stays off until you start.</strong>
                <p>Frames are processed in this browser and are not saved.</p>
              </div>
            )}
          </div>
          <div className="video-caption"><span>LIVE PREVIEW</span><span>{faceCount} {faceCount === 1 ? 'person' : 'people'} detected</span></div>
        </div>

        <aside className="insight-panel">
          <p className="eyebrow">Right now</p>
          <h3>{faceCount ? `${faceCount} expression${faceCount === 1 ? '' : 's'}` : 'Ready when you are'}</h3>
          {expressions.length ? expressions.map((expression, index) => (
            <div className={`expression-row ${expression.tone}`} key={`${index}-${expression.label}`}>
              <span className="person-avatar">{index + 1}</span>
              <div><small>PERSON {index + 1}</small><strong>{expression.label}</strong></div>
              <span className="expression-dot" />
            </div>
          )) : (
            <p className="empty-state">Start the camera to see visible expressions for people in view.</p>
          )}
          <div className="note-card">
            <strong>Not a stress detector</strong>
            <p>Facial expressions do not reliably reveal someone’s feelings or stress. Treat these labels as rough visual cues, not a diagnosis or a fact about a person.</p>
          </div>
        </aside>
      </section>

      <footer className="privacy-note">
        <span aria-hidden="true">⌑</span>
        <p><strong>Private by design</strong> — camera video is analyzed on-device, is not recorded, and stops when you stop the camera or close this page.</p>
      </footer>
    </main>
  )
}

export default App
