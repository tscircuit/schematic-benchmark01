import { readFile } from "node:fs/promises"
import type { JudgeRun, JudgeVerdict } from "./types"

const PROMPT = `You are judging whether two rasterized electronic schematic images represent the same electrical circuit. Ignore drawing style, colors, fonts, line thickness, symbol aesthetics, whitespace, and component placement. Inspect component identities and values, pin-to-pin connectivity, net labels, junctions, and missing or extra parts. A value change or connectivity change is a real difference.

Return ONLY JSON with this exact shape:
{"sameCircuit":boolean,"similarity":number,"confidence":number,"differences":string[],"explanation":string}

similarity and confidence must be numbers from 0 to 1. Use similarity=1 only when the circuits appear electrically identical. Be concise and mention uncertainty caused by unreadable details.`

export interface JudgeOptions {
  model?: string
  repeats?: number
  apiKey?: string
  random?: () => number
}

export async function judgeSchematics(
  referencePng: string,
  candidatePng: string,
  options: JudgeOptions = {},
): Promise<JudgeRun[]> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for model judging")
  const repeats = options.repeats ?? 3
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 9) {
    throw new Error("judge repeats must be an integer from 1 to 9")
  }
  const model = options.model ?? "gpt-5.6"
  const random = options.random ?? Math.random
  const [reference, candidate] = await Promise.all([
    pngDataUrl(referencePng),
    pngDataUrl(candidatePng),
  ])
  const runs: JudgeRun[] = []
  for (let index = 0; index < repeats; index++) {
    const candidateFirst = random() < 0.5
    const images = candidateFirst ? [candidate, reference] : [reference, candidate]
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: "high" },
        max_output_tokens: 1200,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: `${PROMPT}\n\nImage A and Image B follow.` },
            { type: "input_image", image_url: images[0], detail: "high" },
            { type: "input_image", image_url: images[1], detail: "high" },
          ],
        }],
      }),
    })
    if (!response.ok) {
      throw new Error(`OpenAI judge failed: ${response.status} ${await response.text()}`)
    }
    const payload = (await response.json()) as Record<string, unknown>
    const verdict = parseVerdict(outputText(payload))
    runs.push({
      ...verdict,
      responseId: String(payload.id ?? "unknown"),
      imageOrder: candidateFirst ? "candidate-first" : "reference-first",
    })
  }
  return runs
}

export function aggregateJudgeRuns(runs: JudgeRun[]) {
  if (runs.length === 0) throw new Error("cannot aggregate zero judge runs")
  return {
    score: average(runs.map((run) => run.similarity)),
    sameCircuitVote: runs.filter((run) => run.sameCircuit).length / runs.length,
    confidence: average(runs.map((run) => run.confidence)),
    agreement: Math.max(
      runs.filter((run) => run.sameCircuit).length,
      runs.filter((run) => !run.sameCircuit).length,
    ) / runs.length,
    runs,
  }
}

function parseVerdict(text: string): JudgeVerdict {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  const value = JSON.parse(cleaned) as Partial<JudgeVerdict>
  if (
    typeof value.sameCircuit !== "boolean" ||
    typeof value.similarity !== "number" ||
    typeof value.confidence !== "number" ||
    !Array.isArray(value.differences) ||
    typeof value.explanation !== "string"
  ) throw new Error(`judge returned invalid verdict: ${text}`)
  return {
    sameCircuit: value.sameCircuit,
    similarity: clamp(value.similarity),
    confidence: clamp(value.confidence),
    differences: value.differences.map(String),
    explanation: value.explanation,
  }
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text
  const output = Array.isArray(payload.output) ? payload.output : []
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content : []
    for (const part of content) {
      if (typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text
      }
    }
  }
  throw new Error("judge response contained no output text")
}

async function pngDataUrl(path: string) {
  const bytes = await readFile(path)
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error(`${path} is not a PNG file`)
  }
  return `data:image/png;base64,${bytes.toString("base64")}`
}

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
const clamp = (value: number) => Math.max(0, Math.min(1, value))
