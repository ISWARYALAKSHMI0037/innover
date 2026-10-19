import { useCallback, useEffect, useRef, useState } from 'react'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { loadLandmarkClassifier, predictLandmarkClassifier } from './landmarkClassifier'
import {
  classifyFingerCount,
  detectPalmTurnAction,
  resetPalmTurnState,
} from './gestureClassifier'
import './App.css'

const PHRASE_GROUPS = [
  {
    category: 'Urgent & safety',
    phrases: [
      'I need help',
      'Call emergency services',
      'I am in danger',
      'Please stay with me',
      'I need a safe place',
      'There is an emergency',
      'Please get a staff member',
      'I am lost',
      'Please do not leave me alone',
      'I need to contact someone',
    ],
  },
  {
    category: 'Health & care',
    phrases: [
      'I feel unwell',
      'I need a doctor',
      'I need a nurse',
      'I am in pain',
      'I feel dizzy',
      'I feel sick',
      'I need my medication',
      'I have an allergy',
      'I need to sit down',
      'Please call my caregiver',
    ],
  },
  {
    category: 'Daily needs',
    phrases: [
      'I need water',
      'I am hungry',
      'I am thirsty',
      'I need to use the restroom',
      'I am cold',
      'I am hot',
      'I need a break',
      'Please wait',
      'Please help me with this',
      'I am okay',
    ],
  },
  {
    category: 'Food & drink',
    phrases: [
      'I would like some water',
      'I would like something to eat',
      'I would like tea',
      'I would like coffee',
      'I do not eat meat',
      'I am vegetarian',
      'I have a food allergy',
      'What is in this food?',
      'Could I see the menu?',
      'The bill, please',
    ],
  },
  {
    category: 'Travel & directions',
    phrases: [
      'Where is the exit?',
      'Where is the restroom?',
      'Where is the bus stop?',
      'Where is the train station?',
      'Please show me on the map',
      'I need a taxi',
      'Which way should I go?',
      'I need help finding this address',
      'Please tell me when we arrive',
      'I need to get off here',
    ],
  },
  {
    category: 'Conversation',
    phrases: [
      'Hello',
      'Goodbye',
      'Thank you',
      'You are welcome',
      'Please',
      'Yes',
      'No',
      'I do not understand',
      'Could you repeat that?',
      'Please speak slowly',
    ],
  },
  {
    category: 'People & feelings',
    phrases: [
      'I am happy',
      'I am worried',
      'I am scared',
      'I am tired',
      'I feel overwhelmed',
      'I need some quiet',
      'I would like to talk',
      'I miss my family',
      'I need some space',
      'I am feeling better',
    ],
  },
  {
    category: 'Accessibility',
    phrases: [
      'I am deaf',
      'I am hard of hearing',
      'I use sign language',
      'Please write that down',
      'Please get an interpreter',
      'Please face me when speaking',
      'Please get my attention first',
      'I communicate by typing',
      'Please do not shout',
      'Can we use this app to communicate?',
    ],
  },
  {
    category: 'Home & work',
    phrases: [
      'I am ready to begin',
      'I need more time',
      'I need help with this task',
      'Where should I put this?',
      'I have a question',
      'I need to make a phone call',
      'Please send me a message',
      'I will be right back',
      'I have finished',
      'Could you show me how?',
    ],
  },
  {
    category: 'Time & plans',
    phrases: [
      'What time is it?',
      'What time does it start?',
      'I am running late',
      'I am ready',
      'I need to leave now',
      'Can we meet later?',
      'I will be there soon',
      'Please wait for me',
      'I need to change our plans',
      'See you tomorrow',
    ],
  },
]

const PHRASES = PHRASE_GROUPS.flatMap(({ category, phrases }) =>
  phrases.map((phrase) => ({ category, phrase }))
)

const ISL_VIDEOS = [
  {
    title: 'Help | Indian sign language',
    phrase: 'I need help',
    videoId: 'K5P_jVpRnXg',
    source: 'Maa Laxmi Vidhya Mandir',
  },
  {
    title: 'Water in Indian Sign Language',
    phrase: 'I need water',
    videoId: '0opR0e-smkY',
    source: 'PHIN Deaf',
  },
  {
    title: 'Thank You For Your Time',
    phrase: 'Thank you',
    videoId: 'UiSeglerdmE',
    source: 'PHIN Deaf',
  },
  {
    title: 'Greeting',
    phrase: 'Hello',
    videoId: 'wJ3ZSb904x8',
    source: 'Indian Sign Language Research and Training Centre',
  },
  {
    title: 'Doctor',
    phrase: 'I need a doctor',
    videoId: 'Igfn-ktdtoY',
    source: 'Indian Sign Language Research and Training Centre',
  },
  {
    title: 'Please wait for sometime',
    phrase: 'Please wait',
    videoId: 'iL-IYeor7iQ',
    source: 'Talking Hands India',
  },
]

const NUMBER_ACTIONS = Array.from({ length: 10 }, (_, index) => ({
  name: `Finger count ${index + 1}`,
  symbol: String(index + 1),
  phrase: `Number: ${index + 1}`,
  instruction: index < 5
    ? `Extend ${index + 1} finger${index ? 's' : ''} on one hand.`
    : `Show ${index + 1} extended fingers across both hands.`,
}))

const CAMERA_ACTIONS = [
  ...NUMBER_ACTIONS,
  {
    name: 'Palms together (Namaste)',
    symbol: '🙏',
    phrase: 'Hello',
    instruction: 'Bring both hands together, with the fingertips close, and hold steady.',
  },
  {
    name: 'Palm turn',
    symbol: '🔄',
    phrase: 'Both palms flipped',
    instruction: 'Show both open palms, turn them palm-down together, then turn them back toward the camera.',
  },
  {
    name: 'Open palm',
    symbol: '🖐',
    phrase: 'I need help',
    instruction: 'Hold one open hand toward the camera with fingers spread.',
  },
  {
    name: 'Closed fist',
    symbol: '✊',
    phrase: 'Please wait',
    instruction: 'Make a closed fist and hold it steady in the camera view.',
  },
  {
    name: 'Two raised fingers',
    symbol: '✌️',
    phrase: 'Thank you',
    instruction: 'Raise your index and middle fingers; fold the others.',
  },
  {
    name: 'Thumb up',
    symbol: '👍',
    phrase: 'I am okay',
    instruction: 'Make a fist and point your thumb upward.',
  },
  {
    name: 'Thumb and index touch',
    symbol: '👌',
    phrase: 'I need water',
    instruction: 'Touch your thumb and index fingertips together.',
  },
  {
    name: 'Index finger up',
    symbol: '☝️',
    phrase: 'Where are you?',
    instruction: 'Raise only your index finger and hold it steady.',
  },
]

const RECOGNITION_MODES = {
  numbers: {
    label: 'Finger counting 1–10',
    modelPath: '',
    readyStatus: 'Camera ready — finger counting 1–10 and greeting',
  },
  prototype: {
    label: 'Prototype actions',
    modelPath: '',
    readyStatus: 'Camera ready — 6 prototype actions',
  },
  hagrid: {
    label: 'HaGRID gestures',
    modelPath: '/models/hagrid.json',
    readyStatus: 'Camera ready — HaGRID gesture model',
  },
  isl: {
    label: 'ISL alphabet',
    modelPath: '/models/isl-alphabet.json',
    readyStatus: 'Camera ready — ISL alphabet model',
  },
}

const LANDMARK_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]

const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

function classifyCameraAction(landmarks) {
  const palmCenter = {
    x: (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5,
    y: (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5,
  }
  const extended = [
    pointDistance(landmarks[4], palmCenter) > 0.12 && pointDistance(landmarks[4], landmarks[2]) > 0.08,
    landmarks[8].y < landmarks[6].y && pointDistance(landmarks[8], palmCenter) > 0.12,
    landmarks[12].y < landmarks[10].y && pointDistance(landmarks[12], palmCenter) > 0.12,
    landmarks[16].y < landmarks[14].y && pointDistance(landmarks[16], palmCenter) > 0.12,
    landmarks[20].y < landmarks[18].y && pointDistance(landmarks[20], palmCenter) > 0.12,
  ]
  const [thumb, index, middle, ring, pinky] = extended
  const extendedCount = extended.filter(Boolean).length

  if (pointDistance(landmarks[4], landmarks[8]) < 0.1 && !middle && !ring && !pinky) {
    return 'I need water'
  }
  if (extendedCount >= 4 && pointDistance(landmarks[8], landmarks[4]) > 0.22) {
    return 'I need help'
  }
  if (index && middle && !ring && !pinky && !thumb) {
    return 'Thank you'
  }
  if (thumb && !index && !middle && !ring && !pinky) {
    return 'I am okay'
  }
  if (index && !middle && !ring && !pinky && !thumb) {
    return 'Where are you?'
  }
  if (!thumb && !index && !middle && !ring && !pinky) {
    return 'Please wait'
  }

  return null
}

function App() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const modelRef = useRef(null)
  const classifierRef = useRef(null)
  const rafRef = useRef(null)
  const speechEnabledRef = useRef(true)
  const lastDetectedRef = useRef('')
  const pendingGestureRef = useRef('')
  const pendingGestureFramesRef = useRef(0)
  const palmTurnStateRef = useRef({
    baseOrientations: null,
    isTurned: false,
    turnedFrames: 0,
  })

  const [cameraError, setCameraError] = useState('')
  const [status, setStatus] = useState('Camera preview is off')
  const [message, setMessage] = useState('Choose a sign video or a phrase below')
  const [selectedPhrase, setSelectedPhrase] = useState('')
  const [replyInput, setReplyInput] = useState('')
  const [speechEnabled, setSpeechEnabled] = useState(true)
  const [lastReply, setLastReply] = useState('Type a reply to read aloud')
  const [messageSource, setMessageSource] = useState('camera')
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [recognitionMode, setRecognitionMode] = useState('numbers')
  const [phraseSearch, setPhraseSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All phrases')
  const selectedPhraseInfo = PHRASES.find(({ phrase }) => phrase === selectedPhrase)
  const selectedCameraAction = CAMERA_ACTIONS.find(({ phrase }) => phrase === selectedPhrase)
  const selectedVideo = ISL_VIDEOS.find(({ phrase }) => phrase === selectedPhrase)

  const speakText = useCallback((text) => {
    if (!speechEnabledRef.current || !text || typeof window === 'undefined') return

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1
    utterance.pitch = 1
    utterance.lang = 'en-US'
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }, [])

  useEffect(() => {
    if (!cameraEnabled) return undefined

    let cancelled = false
    const videoElement = videoRef.current
    const mode = RECOGNITION_MODES[recognitionMode]

    async function initialise() {
      try {
        setCameraError('')
        setStatus(
          mode.modelPath
            ? `Loading ${mode.label.toLowerCase()} model…`
            : 'Loading hand landmark model…'
        )
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Your browser does not support webcam access.')
        }

        classifierRef.current = mode.modelPath
          ? await loadLandmarkClassifier(mode.modelPath)
          : null
        if (cancelled) return

        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm'
        )

        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          },
          runningMode: 'VIDEO',
          numHands: 2,
        })

        if (cancelled) {
          landmarker.close()
          return
        }

        modelRef.current = landmarker

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 640, height: 480 },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        if (videoElement) {
          videoElement.srcObject = stream
          await videoElement.play()
        }

        setStatus(mode.readyStatus)

        const renderLoop = () => {
          if (!cancelled && videoRef.current && modelRef.current) {
            const video = videoRef.current
            const canvas = canvasRef.current
            const ctx = canvas?.getContext('2d')

            if (video.readyState >= 2 && canvas && ctx) {
              canvas.width = video.videoWidth || 640
              canvas.height = video.videoHeight || 480
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

              const result = modelRef.current.detectForVideo(video, performance.now())
              const hands = result.landmarks || []

              if (hands.length) {
                ctx.strokeStyle = '#7c3aed'
                ctx.lineWidth = 2
                for (const landmarks of hands) {
                  for (const [start, end] of LANDMARK_CONNECTIONS) {
                    const from = landmarks[start]
                    const to = landmarks[end]
                    ctx.beginPath()
                    ctx.moveTo(from.x * canvas.width, from.y * canvas.height)
                    ctx.lineTo(to.x * canvas.width, to.y * canvas.height)
                    ctx.stroke()
                  }

                  for (const point of landmarks) {
                    ctx.beginPath()
                    ctx.arc(point.x * canvas.width, point.y * canvas.height, 4, 0, Math.PI * 2)
                    ctx.fillStyle = '#22c55e'
                    ctx.fill()
                  }
                }

                const prediction = classifierRef.current
                  ? predictLandmarkClassifier(classifierRef.current, hands[0])
                  : null
                const detectedPhrase = classifierRef.current
                  ? prediction?.label === 'no_gesture'
                    ? null
                    : prediction
                      ? recognitionMode === 'isl'
                        ? `ISL letter: ${prediction.label}`
                        : `HaGRID gesture: ${prediction.label}`
                      : null
                  : recognitionMode === 'numbers'
                    ? detectPalmTurnAction(hands, palmTurnStateRef.current)
                      || classifyFingerCount(hands)?.label
                    : classifyCameraAction(hands[0])
                if (detectedPhrase && detectedPhrase === pendingGestureRef.current) {
                  pendingGestureFramesRef.current += 1
                } else {
                  pendingGestureRef.current = detectedPhrase || ''
                  pendingGestureFramesRef.current = detectedPhrase ? 1 : 0
                }
                if (!detectedPhrase) lastDetectedRef.current = ''

                if (detectedPhrase && pendingGestureFramesRef.current >= 8 && lastDetectedRef.current !== detectedPhrase) {
                  lastDetectedRef.current = detectedPhrase
                  setMessage(detectedPhrase)
                  setSelectedPhrase(detectedPhrase)
                  setMessageSource('camera')
                  speakText(detectedPhrase)
                }
              } else {
                resetPalmTurnState(palmTurnStateRef.current)
                pendingGestureRef.current = ''
                pendingGestureFramesRef.current = 0
                lastDetectedRef.current = ''
              }
            }
          }

          rafRef.current = requestAnimationFrame(renderLoop)
        }

        renderLoop()
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'Unable to access camera or model.'

        if (cancelled) return
        setCameraError(message)
        setStatus('Camera unavailable')
        setCameraEnabled(false)
      }
    }

    resetPalmTurnState(palmTurnStateRef.current)
    initialise()

    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (videoElement?.srcObject) {
        const tracks = videoElement.srcObject.getTracks()
        tracks.forEach((track) => track.stop())
      }
      modelRef.current?.close()
      modelRef.current = null
      classifierRef.current = null
      lastDetectedRef.current = ''
      pendingGestureRef.current = ''
      pendingGestureFramesRef.current = 0
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [cameraEnabled, recognitionMode, speakText])

  const handleReply = () => {
    const text = replyInput.trim()
    if (!text) return

    setLastReply(text)
    setReplyInput('')
    speakText(text)
  }

  const filteredPhrases = PHRASES.filter(({ category, phrase }) => {
    const matchesCategory = activeCategory === 'All phrases' || category === activeCategory
    const matchesSearch = phrase.toLowerCase().includes(phraseSearch.trim().toLowerCase())
    return matchesCategory && matchesSearch
  })

  const selectPhrase = (phrase) => {
    lastDetectedRef.current = ''
    setMessage(phrase)
    setSelectedPhrase(phrase)
    setMessageSource('library')
    speakText(phrase)
  }

  const resetMessage = () => {
    setMessage('Ready for a gesture or phrase')
    setSelectedPhrase('')
    setMessageSource('camera')
  }

  const startCamera = () => {
    setCameraError('')
    setStatus('Loading hand landmark model…')
    setCameraEnabled(true)
  }

  const stopCamera = () => {
    setCameraEnabled(false)
    setCameraError('')
    setStatus('Camera preview is off')
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Accessibility prototype</p>
          <h1>SignSpeak</h1>
        </div>
        <div className="topbar-controls">
          <label className="mode-control">
            <span>Recognition mode</span>
            <select
              value={recognitionMode}
              onChange={(event) => setRecognitionMode(event.target.value)}
            >
              {Object.entries(RECOGNITION_MODES).map(([value, mode]) => (
                <option key={value} value={value}>{mode.label}</option>
              ))}
            </select>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={speechEnabled}
              onChange={(event) => {
                speechEnabledRef.current = event.target.checked
                setSpeechEnabled(event.target.checked)
                if (!event.target.checked) window.speechSynthesis?.cancel()
              }}
            />
            Speech enabled
          </label>
        </div>
      </header>

      <section className="layout">
        <div className="panel camera-panel">
          <div className="panel-header">
            <span className={`status-dot${status.startsWith('Camera ready') ? ' active' : ''}${cameraError ? ' error' : ''}`} />
            <strong>{status}</strong>
          </div>

          <div className="video-wrap">
            {cameraEnabled ? (
              <>
                <video ref={videoRef} autoPlay playsInline muted />
                <canvas ref={canvasRef} />
                {cameraError && (
                  <div className="camera-error">
                    <div>{cameraError}</div>
                    <button type="button" onClick={startCamera}>Try again</button>
                  </div>
                )}
              </>
            ) : (
              <div className="camera-off">
                <p>{cameraError || 'Camera stays off until you choose to start the prototype.'}</p>
                <button type="button" onClick={startCamera}>
                  {cameraError ? 'Try again' : 'Start camera preview'}
                </button>
              </div>
            )}
          </div>
          {cameraEnabled && (
            <button className="stop-camera-button" type="button" onClick={stopCamera}>
              Stop camera
            </button>
          )}
        </div>

        <div className="panel output-panel">
          <div className="recognition-card">
            <p className="label">{messageSource === 'camera' ? 'Camera action' : 'Selected message'}</p>
            <h2>{message}</h2>
            <div className="match-row">
              {messageSource === 'camera' ? (
                <span>
                  {recognitionMode === 'hagrid'
                    ? 'HaGRID static gesture classification · not sign-language translation'
                    : recognitionMode === 'isl'
                      ? 'ISL fingerspelling A–Z · not full sign-language recognition'
                      : recognitionMode === 'numbers'
                        ? 'Finger count and greeting demo · not full sign-language recognition'
                        : 'Limited prototype hand-shape match · not full ISL recognition'}
                </span>
              ) : (
                <span>Tap any message below to show and optionally speak it.</span>
              )}
            </div>
            {messageSource === 'library' && (
              <button className="resume-camera-button" type="button" onClick={resetMessage}>
                Clear message
              </button>
            )}
          </div>

          <div className="action-guide-card">
            <div className="action-guide-heading">
              <div>
                <p className="label">Action guide</p>
                <h3>{selectedPhrase || 'Choose an action'}</h3>
              </div>
              {selectedPhraseInfo && (
                <span className="action-category">{selectedPhraseInfo.category}</span>
              )}
            </div>

            {selectedCameraAction ? (
              <div className="action-cue">
                <span className="action-hand-icon" aria-hidden="true">{selectedCameraAction.symbol}</span>
                <div>
                  <strong>Camera demo action: {selectedCameraAction.name}</strong>
                  <p>{selectedCameraAction.instruction}</p>
                  <small>This is a simple app shortcut, not a verified ISL sign.</small>
                </div>
              </div>
            ) : (
              <div className={`action-cue${selectedPhrase ? ' text-only-cue' : ''}`}>
                <span className="action-hand-icon" aria-hidden="true">Aa</span>
                <div>
                  <strong>{selectedPhrase ? 'Text phrase' : 'Choose an action'}</strong>
                  <p>
                    {selectedPhrase
                      ? 'No camera gesture or verified sign guide is assigned to this phrase yet.'
                      : 'Select a message from the action chart, or try the finger-count and camera actions.'}
                  </p>
                </div>
              </div>
            )}

            {selectedVideo && (
              <a
                className="sign-reference"
                href={`https://www.youtube.com/watch?v=${selectedVideo.videoId}`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={`https://i.ytimg.com/vi/${selectedVideo.videoId}/hqdefault.jpg`}
                  alt={`Video reference thumbnail: ${selectedVideo.title}`}
                />
                <span>
                  <strong>Watch sign reference</strong>
                  <small>{selectedVideo.title} · {selectedVideo.source}</small>
                </span>
                <span className="reference-arrow" aria-hidden="true">↗</span>
              </a>
            )}
          </div>

          <div className="reply-box">
            <label htmlFor="reply">Reply text</label>
            <div className="reply-input-row">
              <input
                id="reply"
                value={replyInput}
                onChange={(event) => setReplyInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleReply()
                  }
                }}
                placeholder="Type a reply…"
              />
              <button type="button" onClick={handleReply}>Speak</button>
            </div>
            <p className="last-reply">Last reply: {lastReply}</p>
          </div>
        </div>
      </section>

      <section className="panel action-chart" aria-labelledby="phrase-library-title">
        <div className="phrase-library-header">
          <div>
            <p className="label">Action chart</p>
            <h2 id="phrase-library-title">Choose a message</h2>
            <p className="library-description">
              Select an action to display and optionally speak it.               The finger-count and camera shortcuts are
              marked; other messages work by tapping the chart.
            </p>
          </div>
          <strong className="phrase-count">{PHRASES.length} actions</strong>
        </div>

        <label className="phrase-search-label" htmlFor="phrase-search">Find a phrase</label>
        <input
          className="phrase-search"
          id="phrase-search"
          type="search"
          value={phraseSearch}
          onChange={(event) => setPhraseSearch(event.target.value)}
          placeholder="Search messages…"
        />

        <div className="category-filters" aria-label="Phrase categories">
          {['All phrases', ...PHRASE_GROUPS.map(({ category }) => category)].map((category) => (
            <button
              type="button"
              key={category}
              className={`category-button${activeCategory === category ? ' active' : ''}`}
              aria-pressed={activeCategory === category}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="phrase-grid">
          {filteredPhrases.map(({ category, phrase }) => (
            <article className="phrase-item" key={phrase}>
              <button
                type="button"
                className={`phrase-button${selectedPhrase === phrase ? ' selected' : ''}`}
                onClick={() => selectPhrase(phrase)}
                aria-label={`${phrase}, ${category}`}
                aria-pressed={selectedPhrase === phrase}
              >
                <span>{phrase}</span>
                <small>{category}</small>
                {CAMERA_ACTIONS.some((action) => action.phrase === phrase) && (
                  <small className="camera-action-badge">Camera action</small>
                )}
              </button>
            </article>
          ))}
          {filteredPhrases.length === 0 && (
            <p className="no-phrases">No phrases match your search.</p>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
