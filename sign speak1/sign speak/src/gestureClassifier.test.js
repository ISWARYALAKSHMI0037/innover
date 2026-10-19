import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyFingerCount,
  detectPalmTurnAction,
} from './gestureClassifier.js'

function handWithFingers(fingers, offsetX = 0) {
  const points = Array.from({ length: 21 }, () => ({ x: offsetX + 0.5, y: 0.7 }))
  points[0] = { x: offsetX + 0.5, y: 0.8 }
  points[5] = { x: offsetX + 0.42, y: 0.62 }
  points[9] = { x: offsetX + 0.5, y: 0.59 }
  points[13] = { x: offsetX + 0.58, y: 0.62 }
  points[17] = { x: offsetX + 0.65, y: 0.66 }

  const joints = [3, 6, 10, 14, 18]
  const tips = [4, 8, 12, 16, 20]
  const xPositions = [0.3, 0.42, 0.5, 0.58, 0.68]
  for (let finger = 0; finger < 5; finger += 1) {
    points[joints[finger]] = {
      x: offsetX + (finger === 0 ? 0.42 : xPositions[finger]),
      y: finger === 0 ? 0.76 : 0.46,
    }
    points[tips[finger]] = fingers.includes(finger)
      ? { x: offsetX + (finger === 0 ? 0.22 : xPositions[finger]), y: finger === 0 ? 0.74 : 0.22 }
      : { x: offsetX + (finger === 0 ? 0.45 : xPositions[finger]), y: finger === 0 ? 0.79 : 0.61 }
  }
  return points
}

test('counts one to five extended fingers on one hand', () => {
  for (let count = 1; count <= 5; count += 1) {
    const result = classifyFingerCount([handWithFingers([0, 1, 2, 3, 4].slice(0, count))])
    assert.equal(result?.count, count)
  }
})

test('counts six to ten extended fingers across two hands', () => {
  for (let count = 6; count <= 10; count += 1) {
    const firstCount = Math.ceil(count / 2)
    const secondCount = count - firstCount
    const hands = [
      handWithFingers([0, 1, 2, 3, 4].slice(0, firstCount)),
      handWithFingers([0, 1, 2, 3, 4].slice(0, secondCount), 0.55),
    ]
    const result = classifyFingerCount(hands)
    assert.equal(result?.count, count)
  }
})

test('recognizes palms held together as a greeting before finger counting', () => {
  const hand = handWithFingers([0, 1, 2, 3, 4])
  const result = classifyFingerCount([hand, hand])
  assert.deepEqual(result, { label: 'Hello', kind: 'greeting' })
})

test('recognizes two open palms turned away and back toward the camera', () => {
  const palms = [handWithFingers([0, 1, 2, 3, 4]), handWithFingers([0, 1, 2, 3, 4], 0.55)]
  const turned = palms.map((hand) => hand.map(({ x, y }) => ({ x, y: 1 - y })))
  const state = { baseOrientations: null, isTurned: false, turnedFrames: 0 }

  assert.equal(detectPalmTurnAction(palms, state), null)
  for (let frame = 0; frame < 4; frame += 1) {
    assert.equal(detectPalmTurnAction(turned, state), null)
  }
  assert.equal(detectPalmTurnAction(palms, state), 'Both palms flipped')
})
