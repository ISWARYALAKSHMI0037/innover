const average = (categories, names) => {
  const values = names.map((name) => categories.get(name) || 0)
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function getExpression(blendshapes = []) {
  const categories = new Map(
    blendshapes.map(({ categoryName, score }) => [categoryName, score])
  )
  const smile = average(categories, ['mouthSmileLeft', 'mouthSmileRight'])
  const frown = average(categories, ['mouthFrownLeft', 'mouthFrownRight'])
  const browDown = average(categories, ['browDownLeft', 'browDownRight'])
  const browUp = categories.get('browInnerUp') || 0
  const eyeWide = average(categories, ['eyeWideLeft', 'eyeWideRight'])
  const jawOpen = categories.get('jawOpen') || 0

  if (smile > 0.42) return { label: 'Smiling expression', tone: 'positive' }
  if (eyeWide > 0.45 && jawOpen > 0.35) return { label: 'Surprised expression', tone: 'alert' }
  if (frown > 0.28 || (browDown > 0.38 && browUp > 0.28)) {
    return { label: 'Frowning / tense expression', tone: 'caution' }
  }
  return { label: 'Neutral / unclear expression', tone: 'neutral' }
}
