const FINGER_TIPS = [4, 8, 12, 16, 20]
const FINGER_JOINTS = [3, 6, 10, 14, 18]

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

function getExtendedFingers(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return null

  const wrist = landmarks[0]
  return FINGER_TIPS.map((tipIndex, index) => {
    const tipDistance = distance(landmarks[tipIndex], wrist)
    const jointDistance = distance(landmarks[FINGER_JOINTS[index]], wrist)
    if (index !== 0) return tipDistance > jointDistance * 1.12
    return tipDistance > jointDistance * 1.12 && distance(landmarks[tipIndex], landmarks[5]) > 0.18
  })
}

function isOpenPalm(landmarks) {
  return getExtendedFingers(landmarks)?.every(Boolean) ?? false
}

function getPalmOrientation(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return 0
  const wrist = landmarks[0]
  const indexBase = landmarks[5]
  const pinkyBase = landmarks[17]
  const area = (indexBase.x - wrist.x) * (pinkyBase.y - wrist.y)
    - (indexBase.y - wrist.y) * (pinkyBase.x - wrist.x)
  return Math.abs(area) < 0.0005 ? 0 : Math.sign(area)
}

export function resetPalmTurnState(state) {
  state.baseOrientations = null
  state.isTurned = false
  state.turnedFrames = 0
}

export function detectPalmTurnAction(hands, state) {
  if (!Array.isArray(hands) || hands.length !== 2 || hands.some((hand) => !isOpenPalm(hand))) {
    resetPalmTurnState(state)
    return null
  }

  const orientations = hands.map(getPalmOrientation)
  if (orientations.includes(0)) return null
  if (!state.baseOrientations) {
    state.baseOrientations = orientations
    return null
  }

  const matchesBase = orientations.every((orientation, index) =>
    orientation === state.baseOrientations[index]
  )
  const matchesTurn = orientations.every((orientation, index) =>
    orientation === -state.baseOrientations[index]
  )

  if (!state.isTurned) {
    if (matchesTurn) {
      state.isTurned = true
      state.turnedFrames = 1
    } else if (!matchesBase) {
      state.baseOrientations = orientations
    }
    return null
  }

  if (matchesTurn) {
    state.turnedFrames += 1
    return null
  }
  if (matchesBase) {
    const completed = state.turnedFrames >= 3
    resetPalmTurnState(state)
    state.baseOrientations = orientations
    return completed ? 'Both palms flipped' : null
  }

  resetPalmTurnState(state)
  state.baseOrientations = orientations
  return null
}

function isPrayerPose(hands) {
  if (hands.length !== 2) return false

  const [first, second] = hands
  const firstScale = distance(first[0], first[9])
  const secondScale = distance(second[0], second[9])
  const averageScale = (firstScale + secondScale) / 2
  if (averageScale < 1e-6) return false

  const wristsTogether = distance(first[0], second[0]) < averageScale * 0.9
  const fingertipsTogether = [8, 12, 16, 20].every(
    (index) => distance(first[index], second[index]) < averageScale * 0.85
  )
  return wristsTogether && fingertipsTogether
}

export function classifyFingerCount(hands) {
  if (!Array.isArray(hands) || hands.length === 0 || hands.length > 2) return null
  if (isPrayerPose(hands)) return { label: 'Hello', kind: 'greeting' }

  const fingerCounts = hands.map((hand) => {
    const extended = getExtendedFingers(hand)
    return extended ? extended.filter(Boolean).length : null
  })
  if (fingerCounts.some((count) => count === null)) return null

  const total = fingerCounts.reduce((sum, count) => sum + count, 0)
  if (total < 1 || total > 10) return null
  return { label: `Number: ${total}`, kind: 'number', count: total }
}
