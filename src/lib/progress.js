/**
 * Create a set of callbacks that can be used to track progress of a multistep process.
 *
 * @param {(number[]|number)} steps
 * @param {import('svelte').State<number>} progress
 * @returns {((progress: number) => void)[]}
 */
export function createSteps(steps, progress) {
  const stepWeights = typeof steps === 'number' ? Array(steps).fill(1) : steps

  const progressParts = Array(stepWeights.length).fill(0)
  const totalSize = stepWeights.reduce((total, weight) => total + weight, 0)

  function updateProgress() {
    const weightedAverage = stepWeights.reduce((acc, weight, idx) => {
      return acc + progressParts[idx] * weight
    }, 0)
    progress = weightedAverage / totalSize
  }

  return stepWeights.map((weight, idx) => (progress) => {
    if (progressParts[idx] !== progress) {
      progressParts[idx] = progress
      updateProgress()
    }
  })
}

/**
 * Iterate over a list of steps while reporting progress.
 * @template T
 * @param {(number[]|T[])} steps
 * @param {import('svelte').State<number>} progress
 * @returns {([T, (progress: number) => void])[]}
 */
export function withProgress(steps, progress) {
  const callbacks = createSteps(
    steps.map(step => typeof step === 'number' ? step : step.size || step.length || 1),
    progress,
  )
  return steps.map((step, idx) => [step, callbacks[idx]])
}
