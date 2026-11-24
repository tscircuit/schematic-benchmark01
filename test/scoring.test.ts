import { describe, expect, test } from "bun:test"
import { manifestFromCircuitJson, manifestFromOpenSchematicsJson } from "../src/manifest"
import { combineScores, multisetF1 } from "../src/scoring"
import { aggregateJudgeRuns } from "../src/judge"

describe("multiset scoring", () => {
  test("penalizes missing and duplicate components", () => {
    expect(multisetF1(["r|10k", "r|10k", "c|1uf"], ["r|10k", "c|1uf"]).score).toBeCloseTo(0.8)
  })

  test("renormalizes weights when optional dimensions are absent", () => {
    const manifest = { components: [{ type: "R", value: "10k" }] }
    const result = combineScores(manifest, manifest)
    expect(result.total).toBe(1)
    expect(result.effectiveWeights.components).toBe(1)
    expect(result.warnings).toHaveLength(2)
  })
})

test("normalizes KiCad and tscircuit passive component type aliases", () => {
  const reference = {
    components: [
      { type: "R", value: "10k" },
      { type: "C", value: "100nF" },
    ],
  }
  const candidate = {
    components: [
      { type: "simple_resistor", value: "10k" },
      { type: "simple_capacitor", value: "100nF" },
    ],
  }

  expect(combineScores(reference, candidate).dimensions.components.score).toBe(1)
})

test("aggregates repeated model judgments", () => {
  const result = aggregateJudgeRuns([
    { sameCircuit: true, similarity: 0.9, confidence: 0.8, differences: [], explanation: "same", responseId: "1", imageOrder: "reference-first" },
    { sameCircuit: true, similarity: 0.8, confidence: 0.9, differences: [], explanation: "same", responseId: "2", imageOrder: "candidate-first" },
    { sameCircuit: false, similarity: 0.4, confidence: 0.6, differences: ["unclear"], explanation: "different", responseId: "3", imageOrder: "reference-first" },
  ])
  expect(result.sameCircuitVote).toBeCloseTo(2 / 3)
  expect(result.agreement).toBeCloseTo(2 / 3)
  expect(result.score).toBeCloseTo(0.7)
})

describe("manifest adapters", () => {
  test("extracts Open Schematics symbols", () => {
    const result = manifestFromOpenSchematicsJson(JSON.stringify({
      schematicSymbols: [{ entryName: "R", properties: [{ key: "Reference", value: "R1" }, { key: "Value", value: "10k" }] }],
    }))
    expect(result.components).toEqual([{ reference: "R1", type: "R", value: "10k" }])
  })

  test("extracts Circuit JSON components and connectivity", () => {
    const result = manifestFromCircuitJson([
      { type: "source_component", source_component_id: "a", name: "R1", ftype: "resistor", resistance: "10k" },
      { type: "source_component", source_component_id: "b", name: "C1", ftype: "capacitor", capacitance: "1uF" },
      { type: "source_port", source_port_id: "p1", source_component_id: "a", pin_number: "1" },
      { type: "source_port", source_port_id: "p2", source_component_id: "b", pin_number: "2" },
      { type: "source_trace", connected_source_port_ids: ["p1", "p2"] },
    ])
    expect(result.components).toHaveLength(2)
    expect(result.nets).toEqual([{ members: ["R1.1", "C1.2"] }])
  })
})
