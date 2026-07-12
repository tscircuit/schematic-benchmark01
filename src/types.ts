export interface Component {
  reference?: string
  type: string
  value?: string
}

export interface Net {
  name?: string
  members: string[]
}

export interface Manifest {
  components: Component[]
  nets?: Net[]
}

export interface DimensionScore {
  score: number
  matched?: number
  reference?: number
  candidate?: number
}

export interface ScoreResult {
  version: 1
  total: number
  dimensions: {
    components: DimensionScore
    connectivity?: DimensionScore
    visual?: DimensionScore
  }
  effectiveWeights: Record<string, number>
  warnings: string[]
}
