import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import sharp from "sharp"

const FORBIDDEN_JSX = /<\s*(schematicline|netlabel)\b/i

export interface GeneratedArtifacts {
  entrypoint: string
  circuitJson: string
  schematicSvg: string
  schematicPng: string
  hashes: Record<"tsxSha256" | "circuitJsonSha256" | "schematicSvgSha256" | "schematicPngSha256", string>
}

export function assertSourceOnlyTsx(source: string, path = "source") {
  const match = source.match(FORBIDDEN_JSX)
  if (match) {
    throw new Error(`${path} uses forbidden <${match[1]}>; benchmark circuits must use components and <trace> connectivity only`)
  }
}

export function assertNoManualSchematicElements(circuitJson: unknown) {
  if (!Array.isArray(circuitJson)) throw new Error("generated Circuit JSON must be an array")
  if (circuitJson.some((element) => typeof element === "object" && element !== null && (element as { type?: unknown }).type === "schematic_line")) {
    throw new Error("generated Circuit JSON contains schematic_line elements; manual schematic drawing is forbidden")
  }
}

export async function auditCandidateSources(candidateDir: string) {
  const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx,mjs,cjs}")
  for await (const relativePath of glob.scan({ cwd: candidateDir, onlyFiles: true })) {
    if (relativePath.startsWith("node_modules/") || relativePath.startsWith("dist/")) continue
    assertSourceOnlyTsx(await readFile(join(candidateDir, relativePath), "utf8"), relativePath)
  }
}

export async function buildCandidate(trialDir: string, entrypoint = "index.circuit.tsx"): Promise<GeneratedArtifacts> {
  const candidateDir = join(trialDir, "candidate")
  const entryPath = join(candidateDir, entrypoint)
  if (!existsSync(entryPath)) throw new Error(`candidate entrypoint not found: ${entryPath}`)
  await auditCandidateSources(candidateDir)

  // Never trust artifacts left by the agent. Start clean, invoke tsci ourselves,
  // and immediately copy the build outputs outside the candidate workspace.
  await rm(join(candidateDir, "dist"), { recursive: true, force: true })
  const process = Bun.spawn(["bunx", "tsci", "build", entrypoint, "--all-images", "--ignore-errors"], {
    cwd: candidateDir,
    stdout: "pipe",
    stderr: "pipe",
    env: processEnvWithoutSecrets(),
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`tsci build failed (${exitCode})\n${stdout}\n${stderr}`.trim())

  const buildDir = await findSingleBuildDir(join(candidateDir, "dist"))
  const circuitBytes = await readFile(join(buildDir, "circuit.json"))
  assertNoManualSchematicElements(JSON.parse(circuitBytes.toString("utf8")))
  const svgBytes = await readFile(join(buildDir, "schematic.svg"))
  const pngBytes = await sharp(svgBytes).png().toBuffer()
  const sourceBytes = await readFile(entryPath)
  const generatedDir = join(trialDir, "generated")
  await rm(generatedDir, { recursive: true, force: true })
  await mkdir(generatedDir, { recursive: true })
  const circuitJson = join(generatedDir, "circuit.json")
  const schematicSvg = join(generatedDir, "schematic.svg")
  const schematicPng = join(generatedDir, "schematic.png")
  await Promise.all([
    writeFile(circuitJson, circuitBytes),
    writeFile(schematicSvg, svgBytes),
    writeFile(schematicPng, pngBytes),
  ])
  const hashes = {
    tsxSha256: digest(sourceBytes),
    circuitJsonSha256: digest(circuitBytes),
    schematicSvgSha256: digest(svgBytes),
    schematicPngSha256: digest(pngBytes),
  }
  await writeFile(join(generatedDir, "provenance.json"), `${JSON.stringify({ entrypoint, command: ["tsci", "build", entrypoint, "--all-images", "--ignore-errors"], hashes }, null, 2)}\n`)
  return { entrypoint, circuitJson, schematicSvg, schematicPng, hashes }
}

async function findSingleBuildDir(distDir: string) {
  const matches: string[] = []
  const glob = new Bun.Glob("**/circuit.json")
  for await (const relativePath of glob.scan({ cwd: distDir, onlyFiles: true })) {
    const directory = dirname(join(distDir, relativePath))
    if (existsSync(join(directory, "schematic.svg"))) matches.push(directory)
  }
  if (matches.length !== 1) throw new Error(`expected one tsci schematic build under ${distDir}, found ${matches.length}`)
  return matches[0]!
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function processEnvWithoutSecrets() {
  const env = { ...process.env }
  delete env.OPENAI_API_KEY
  delete env.TSCIRCUIT_JWT
  return env
}
