import test from 'node:test'
import assert from 'node:assert/strict'
import { getExpression } from './expression.js'

test('labels a visible smile without claiming an internal emotion', () => {
  const result = getExpression([
    { categoryName: 'mouthSmileLeft', score: 0.8 },
    { categoryName: 'mouthSmileRight', score: 0.8 },
  ])
  assert.deepEqual(result, { label: 'Smiling expression', tone: 'positive' })
})

test('uses an uncertain label when expression cues are weak', () => {
  assert.deepEqual(getExpression([]), {
    label: 'Neutral / unclear expression',
    tone: 'neutral',
  })
})
