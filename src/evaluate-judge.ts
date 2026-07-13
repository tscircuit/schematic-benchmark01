import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import sharp from "sharp"
import { aggregateJudgeRuns, judgeSchematics } from "./judge"

type Fixture = { id: string; expectedSame: boolean; svg: string; mutation: string }
const outputDir = resolve(process.argv[2] ?? "eval-results/judge")
const repeats = Number(process.env.JUDGE_REPEATS ?? "3")
const model = process.env.OPENAI_JUDGE_MODEL ?? "gpt-5.6-sol"

await mkdir(join(outputDir, "png"), { recursive: true })
const reference = schematicSvg({})
const referencePath = join(outputDir, "png", "reference.png")
await rasterize(reference, referencePath)

const fixtures: Fixture[] = [
  { id: "same-dark-theme", expectedSame: true, mutation: "colors, font, background, and stroke width", svg: schematicSvg({ theme: "dark" }) },
  { id: "same-blue-theme", expectedSame: true, mutation: "colors, font, dashed power wires, and stroke width", svg: schematicSvg({ theme: "blue" }) },
  { id: "same-wide-layout", expectedSame: true, mutation: "horizontal spacing plus styling", svg: schematicSvg({ theme: "blue", wide: true }) },
  { id: "different-value", expectedSame: false, mutation: "R2 changed from 10k to 1k", svg: schematicSvg({ r2: "1k" }) },
  { id: "different-open-net", expectedSame: false, mutation: "output-to-C1 wire removed", svg: schematicSvg({ disconnectCap: true }) },
  { id: "different-extra-load", expectedSame: false, mutation: "extra 1k load resistor from OUT to ground", svg: schematicSvg({ extraLoad: true }) },
]

const results = []
for (const fixture of fixtures) {
  const candidatePath = join(outputDir, "png", `${fixture.id}.png`)
  await rasterize(fixture.svg, candidatePath)
  const aggregate = aggregateJudgeRuns(await judgeSchematics(referencePath, candidatePath, { model, repeats }))
  const predictedSame = aggregate.sameCircuitVote >= 0.5
  results.push({
    id: fixture.id,
    expectedSame: fixture.expectedSame,
    predictedSame,
    correct: predictedSame === fixture.expectedSame,
    mutation: fixture.mutation,
    ...aggregate,
  })
  console.log(`${fixture.id}: expected=${fixture.expectedSame} predicted=${predictedSame} similarity=${aggregate.score.toFixed(2)} agreement=${aggregate.agreement.toFixed(2)}`)
}

const correct = results.filter((result) => result.correct).length
const positives = results.filter((result) => result.expectedSame)
const negatives = results.filter((result) => !result.expectedSame)
const report = {
  model,
  repeats,
  generatedAt: new Date().toISOString(),
  pngOnly: true,
  summary: {
    cases: results.length,
    calls: results.length * repeats,
    accuracy: correct / results.length,
    equivalentRecall: positives.filter((result) => result.predictedSame).length / positives.length,
    changedRecall: negatives.filter((result) => !result.predictedSame).length / negatives.length,
    meanAgreement: results.reduce((sum, result) => sum + result.agreement, 0) / results.length,
  },
  results,
}
await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`)
await writeFile(join(outputDir, "README.md"), markdownReport(report))
console.log(`accuracy ${(report.summary.accuracy * 100).toFixed(1)}%; report: ${join(outputDir, "report.json")}`)

async function rasterize(svg: string, path: string) {
  // Sharp is deliberately used only to rasterize; the judge never receives SVG.
  await sharp(Buffer.from(svg)).png().toFile(path)
}

function schematicSvg(options: { theme?: "dark" | "blue"; wide?: boolean; r2?: string; disconnectCap?: boolean; extraLoad?: boolean }) {
  const dark = options.theme === "dark"
  const blue = options.theme === "blue"
  const bg = dark ? "#17202a" : blue ? "#eef7ff" : "#ffffff"
  const ink = dark ? "#f7dc6f" : blue ? "#075985" : "#111827"
  const accent = dark ? "#58d68d" : blue ? "#dc2626" : "#047857"
  const stroke = dark ? 4 : blue ? 3 : 2
  const font = dark ? "monospace" : blue ? "serif" : "sans-serif"
  const right = options.wide ? 700 : 610
  const mid = (260 + right) / 2
  const capWire = options.disconnectCap ? `<line x1="${mid}" y1="300" x2="${mid + 55}" y2="300"/><circle cx="${mid + 48}" cy="300" r="3" fill="${accent}"/>` : `<line x1="${mid}" y1="300" x2="${mid + 90}" y2="300"/>`
  const extra = options.extraLoad ? `<line x1="${mid}" y1="300" x2="${mid - 90}" y2="300"/><rect x="${mid - 105}" y="335" width="30" height="100" rx="4"/><line x1="${mid - 90}" y1="300" x2="${mid - 90}" y2="335"/><line x1="${mid - 90}" y1="435" x2="${mid - 90}" y2="500"/><path d="M ${mid - 118} 500 h 56 m -44 10 h 32 m -20 10 h 8"/><text x="${mid - 150}" y="380">R3</text><text x="${mid - 150}" y="405">1k</text>` : ""
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">
  <rect width="900" height="600" fill="${bg}"/>
  <g fill="none" stroke="${ink}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" font-family="${font}" font-size="24">
    <line x1="260" y1="100" x2="${right}" y2="100" ${blue ? 'stroke-dasharray="8 5"' : ""}/>
    <path d="M ${mid} 70 l -18 30 h 36 z" fill="${accent}"/><text x="${mid + 28}" y="92" fill="${ink}" stroke="none">VCC</text>
    <line x1="${mid}" y1="100" x2="${mid}" y2="145"/><rect x="${mid - 15}" y="145" width="30" height="100" rx="${dark ? 10 : 2}"/>
    <line x1="${mid}" y1="245" x2="${mid}" y2="300"/><circle cx="${mid}" cy="300" r="6" fill="${accent}" stroke="none"/>
    <line x1="${mid}" y1="300" x2="${mid}" y2="355"/><rect x="${mid - 15}" y="355" width="30" height="100" rx="${dark ? 10 : 2}"/>
    <line x1="${mid}" y1="455" x2="${mid}" y2="500"/><path d="M ${mid - 28} 500 h 56 m -44 10 h 32 m -20 10 h 8"/>
    ${capWire}<line x1="${mid + 90}" y1="300" x2="${mid + 90}" y2="365"/><line x1="${mid + 60}" y1="365" x2="${mid + 120}" y2="365"/><line x1="${mid + 60}" y1="385" x2="${mid + 120}" y2="385"/><line x1="${mid + 90}" y1="385" x2="${mid + 90}" y2="500"/><path d="M ${mid + 62} 500 h 56 m -44 10 h 32 m -20 10 h 8"/>
    ${extra}
    <g fill="${ink}" stroke="none"><text x="${mid - 90}" y="185">R1</text><text x="${mid - 100}" y="215">10k</text><text x="${mid - 90}" y="395">R2</text><text x="${mid - 100}" y="425">${options.r2 ?? "10k"}</text><text x="${mid + 130}" y="375">C1 100nF</text><text x="${mid + 20}" y="290">OUT</text><text x="55" y="555" font-size="18">Voltage divider with output filter</text></g>
  </g></svg>`
}

function markdownReport(report: {
  model: string
  summary: { accuracy: number; equivalentRecall: number; changedRecall: number; meanAgreement: number; calls: number }
}) {
  return `# Judge evaluation\n\nModel: ${report.model}\n\n- Accuracy: ${(report.summary.accuracy * 100).toFixed(1)}%\n- Equivalent recall: ${(report.summary.equivalentRecall * 100).toFixed(1)}%\n- Changed-circuit recall: ${(report.summary.changedRecall * 100).toFixed(1)}%\n- Mean repeat agreement: ${(report.summary.meanAgreement * 100).toFixed(1)}%\n- Calls: ${report.summary.calls}\n\nSee \`report.json\` for every raw verdict and difference explanation.\n`
}
