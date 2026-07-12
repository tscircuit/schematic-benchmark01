import { componentKey, netKey } from "./manifest"
import type { DimensionScore, Manifest, ScoreResult } from "./types"

export function multisetF1(reference: string[], candidate: string[]): DimensionScore {
  const available = new Map<string, number>()
  for (const key of reference) available.set(key, (available.get(key) ?? 0) + 1)
  let matched = 0
  for (const key of candidate) {
    const count = available.get(key) ?? 0
    if (count > 0) {
      matched++
      available.set(key, count - 1)
    }
  }
  const precision = candidate.length === 0 ? 0 : matched / candidate.length
  const recall = reference.length === 0 ? 0 : matched / reference.length
  const score = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { score, matched, reference: reference.length, candidate: candidate.length }
}

export function combineScores(
  reference: Manifest,
  candidate: Manifest,
  modelJudge?: number,
): ScoreResult {
  const warnings: string[] = []
  const components = multisetF1(
    reference.components.map(componentKey),
    candidate.components.map(componentKey),
  )
  const dimensions: ScoreResult["dimensions"] = { components }
  const weights: Record<string, number> = { components: 0.6 }
  if (reference.nets?.length && candidate.nets?.length) {
    dimensions.connectivity = multisetF1(reference.nets.map(netKey), candidate.nets.map(netKey))
    weights.connectivity = 0.25
  } else {
    warnings.push("connectivity omitted: reference or candidate nets are unavailable")
  }
  if (modelJudge !== undefined) {
    dimensions.modelJudge = { score: modelJudge }
    weights.modelJudge = 0.15
  } else {
    warnings.push("model judge omitted: reference/candidate PNG or API access is unavailable")
  }
  const denominator = Object.values(weights).reduce((sum, value) => sum + value, 0)
  const effectiveWeights = Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [key, value / denominator]),
  )
  const total = Object.entries(effectiveWeights).reduce(
    (sum, [key, weight]) =>
      sum + dimensions[key as keyof typeof dimensions]!.score * weight,
    0,
  )
  return { version: 1, total, dimensions, effectiveWeights, warnings }
}
