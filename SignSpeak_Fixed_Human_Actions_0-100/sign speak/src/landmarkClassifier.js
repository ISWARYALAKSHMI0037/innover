const MODEL_SCHEMA = 'signspeak-landmark-mlp-v1'

function readPointCoordinates(point) {
  if (Array.isArray(point)) {
    if (point.length < 2) return null
    return [Number(point[0]), Number(point[1])]
  }

  if (point && typeof point === 'object') {
    return [Number(point.x), Number(point.y)]
  }

  return null
}

export function normalizeHandLandmarks(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return null

  const values = []
  for (const point of landmarks) {
    const coordinates = readPointCoordinates(point)
    if (!coordinates || !coordinates.every(Number.isFinite)) return null
    values.push(...coordinates)
  }

  const wristX = values[0]
  const wristY = values[1]
  let scale = 0
  for (let index = 0; index < values.length; index += 2) {
    const x = values[index] - wristX
    const y = values[index + 1] - wristY
    values[index] = x
    values[index + 1] = y
    scale = Math.max(scale, Math.hypot(x, y))
  }
  if (scale < 1e-6) return null

  return values.map((value) => value / scale)
}

export function validateLandmarkClassifier(model) {
  if (
    !model ||
    model.schema !== MODEL_SCHEMA ||
    model.inputSize !== 42 ||
    !Array.isArray(model.classes) ||
    model.classes.length < 2 ||
    !Array.isArray(model.layers) ||
    model.layers.length < 2 ||
    model.scaler?.mean?.length !== 42 ||
    model.scaler?.scale?.length !== 42
  ) {
    throw new Error('The trained model has an unsupported or invalid format.')
  }

  let inputSize = 42
  for (const layer of model.layers) {
    if (
      !Array.isArray(layer.weights) ||
      layer.weights.length !== inputSize ||
      !Array.isArray(layer.bias) ||
      layer.weights.some((row) => row.length !== layer.bias.length) ||
      !['relu', 'softmax'].includes(layer.activation)
    ) {
      throw new Error('The trained model contains invalid layer dimensions.')
    }
    inputSize = layer.bias.length
  }
  if (inputSize !== model.classes.length) {
    throw new Error('The trained model output does not match its class labels.')
  }
  return model
}

export async function loadLandmarkClassifier(path) {
  const response = await fetch(path, { cache: 'no-store' })
  const filename = path.split('/').pop()
  const trainingCommand = filename === 'hagrid.json'
    ? 'python training\\train.py --dataset hagrid --hagrid-annotations "<path-to-ann_train_val>"'
    : 'python training\\train.py --dataset isl --realsign-dir "<path-to-RealSign-Dataset>"'

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        `Trained model ${filename} is missing. Generate it with ${trainingCommand} from the project root. See training/README.md.`
      )
    }
    throw new Error(`Unable to load trained model ${filename} (${response.status}).`)
  }

  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(
      `Expected ${filename} to be a JSON model, but the server returned a different file. Generate it with ${trainingCommand} from the project root. See training/README.md.`
    )
  }
  return validateLandmarkClassifier(await response.json())
}

export function predictLandmarkClassifier(model, landmarks) {
  const features = normalizeHandLandmarks(landmarks)
  if (!features) return null

  let activations = features.map((value, index) => {
    const mean = model.scaler.mean[index]
    const scale = model.scaler.scale[index] || 1
    return (value - mean) / scale
  })

  for (const layer of model.layers) {
    const outputs = layer.bias.map((bias, outputIndex) => {
      let value = bias
      for (let inputIndex = 0; inputIndex < activations.length; inputIndex += 1) {
        value += activations[inputIndex] * layer.weights[inputIndex][outputIndex]
      }
      return layer.activation === 'relu' ? Math.max(0, value) : value
    })

    if (layer.activation === 'softmax') {
      const maximum = Math.max(...outputs)
      const exponentials = outputs.map((value) => Math.exp(value - maximum))
      const total = exponentials.reduce((sum, value) => sum + value, 0)
      activations = exponentials.map((value) => value / total)
    } else {
      activations = outputs
    }
  }

  let bestIndex = 0
  for (let index = 1; index < activations.length; index += 1) {
    if (activations[index] > activations[bestIndex]) bestIndex = index
  }

  const confidence = activations[bestIndex]
  if (confidence < (model.minConfidence ?? 0.6)) return null
  return { label: model.classes[bestIndex], confidence }
}
