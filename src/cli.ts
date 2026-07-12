import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { manifestFromCircuitJson, manifestFromOpenSchematicsJson } from "./manifest"
import { aggregateJudgeRuns, judgeSchematics } from "./judge"
import { combineScores } from "./scoring"
import type { Manifest } from "./types"
import { buildCandidate } from "./build-candidate"

const DATASET = "bshada/open-schematics"
const ROOT = resolve(import.meta.dir, "..")

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : process.argv[index + 1]
}

function required(name: string) {
  const value = option(name)
  if (!value) throw new Error(`missing --${name}`)
  return value
}

async function fetchCase() {
  const row = Number(required("row"))
  if (!Number.isInteger(row) || row < 0) throw new Error("--row must be a non-negative integer")
  const caseId = String(row).padStart(6, "0")
  const caseDir = join(ROOT, "cases", caseId)
  if (existsSync(caseDir) && !process.argv.includes("--force")) {
    throw new Error(`${caseDir} already exists; pass --force to replace files`)
  }
  const url = new URL("https://datasets-server.huggingface.co/rows")
  url.search = new URLSearchParams({ dataset: DATASET, config: "default", split: "train", offset: String(row), length: "1" }).toString()
  const response = await fetch(url)
  if (!response.ok) throw new Error(`dataset request failed: ${response.status} ${response.statusText}`)
  const payload = (await response.json()) as { rows?: Array<{ row?: Record<string, unknown> }> }
  const source = payload.rows?.[0]?.row
  if (!source) throw new Error(`dataset returned no row at offset ${row}`)
  if (typeof source.schematic_json !== "string") {
    throw new Error("selected row has no KiCad schematic_json; choose another row")
  }
  const manifest = manifestFromOpenSchematicsJson(source.schematic_json)
  const publicDir = join(caseDir, "task")
  const privateDir = join(caseDir, ".benchmark")
  await mkdir(publicDir, { recursive: true })
  await mkdir(privateDir, { recursive: true })
  const imageUrl = imageSource(source.schematic_image)
  let imageFile: string | undefined
  if (imageUrl) {
    const imageResponse = await fetch(imageUrl)
    if (imageResponse.ok) {
      imageFile = "reference.png"
      await Bun.write(join(publicDir, imageFile), await imageResponse.arrayBuffer())
    }
  }
  const prompt = `# Schematic recreation task\n\nRecreate the supplied schematic as a tscircuit TSX design. Preserve component types, values, and connectivity as closely as possible. Use declarative components and <trace> elements. <schematicline> and <netlabel> are forbidden. Do not create or modify Circuit JSON, SVG, or PNG output; the benchmark will build and render your TSX independently. Do not access the sibling \`.benchmark\` directory.\n\nSource project: ${String(source.name ?? "unknown")}\nDescription: ${String(source.description ?? "") || "(none)"}\nReference image: ${imageFile ?? "unavailable"}\n`
  await writeFile(join(publicDir, "README.md"), prompt)
  const digest = createHash("sha256").update(source.schematic_json).digest("hex")
  await writeJson(join(privateDir, "reference.json"), manifest)
  await writeJson(join(privateDir, "provenance.json"), {
    dataset: DATASET,
    config: "default",
    split: "train",
    row,
    source: source.name,
    schematicJsonSha256: digest,
    fetchedAt: new Date().toISOString(),
  })
  console.log(`prepared case ${caseId} at ${caseDir}`)
}

async function newTrial() {
  const caseId = required("case")
  const caseDir = join(ROOT, "cases", caseId)
  if (!existsSync(join(caseDir, ".benchmark", "reference.json"))) throw new Error(`unknown case ${caseId}`)
  const id = option("label") ?? new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z")
  const trialDir = join(ROOT, "trials", caseId, id)
  await mkdir(join(trialDir, "candidate"), { recursive: true })
  await Bun.$`cp -R ${join(caseDir, "task")} ${join(trialDir, "task")}`
  await writeFile(join(trialDir, "candidate", "README.md"), "Create index.circuit.tsx using declarative components and <trace> connectivity. <schematicline> and <netlabel> are forbidden. Candidate-generated Circuit JSON, SVG, PNG, and manifests are ignored; the benchmark rebuilds from TSX.\n")
  await writeJson(join(trialDir, "trial.json"), { case: caseId, label: id, createdAt: new Date().toISOString() })
  console.log(`created trial ${trialDir}`)
}

async function scoreTrial() {
  const trialDir = resolve(required("trial"))
  const trial = JSON.parse(await readFile(join(trialDir, "trial.json"), "utf8")) as { case: string }
  const caseDir = join(ROOT, "cases", trial.case)
  const reference = await readManifest(join(caseDir, ".benchmark", "reference.json"))
  const generated = await buildCandidate(trialDir, option("entry") ?? "index.circuit.tsx")
  const candidate = manifestFromCircuitJson(JSON.parse(await readFile(generated.circuitJson, "utf8")))
  const referenceImage = join(caseDir, "task", "reference.png")
  const candidateImage = generated.schematicPng
  const judge = existsSync(referenceImage) && existsSync(candidateImage)
    ? aggregateJudgeRuns(await judgeSchematics(referenceImage, candidateImage, {
        model: option("model"),
        repeats: option("judge-runs") ? Number(option("judge-runs")) : undefined,
      }))
    : undefined
  // The validation suite shows similarity is useful context but not calibrated:
  // subtle real changes can still receive ~0.9. Use the repeated binary vote.
  const result = combineScores(reference, candidate, judge?.sameCircuitVote)
  await writeJson(join(trialDir, "score.json"), {
    ...result,
    case: trial.case,
    trial: basename(trialDir),
    scoredAt: new Date().toISOString(),
    judge,
    generated: { entrypoint: generated.entrypoint, hashes: generated.hashes },
  })
  console.log(`score ${(result.total * 100).toFixed(1)}%`)
  console.log(JSON.stringify(result.dimensions, null, 2))
}

function imageSource(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (typeof value === "object" && value !== null && typeof (value as { src?: unknown }).src === "string") return (value as { src: string }).src
  return undefined
}

async function readManifest(path: string): Promise<Manifest> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as Manifest
  if (!Array.isArray(parsed.components) || parsed.components.length === 0) throw new Error(`${path} has no components`)
  return parsed
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

const command = process.argv[2]
try {
  if (command === "fetch") await fetchCase()
  else if (command === "new") await newTrial()
  else if (command === "build") {
    const generated = await buildCandidate(resolve(required("trial")), option("entry") ?? "index.circuit.tsx")
    console.log(JSON.stringify(generated, null, 2))
  }
  else if (command === "score") await scoreTrial()
  else throw new Error("usage: cli.ts <fetch|new|build|score> [options]")
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
