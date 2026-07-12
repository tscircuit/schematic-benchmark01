# schematic-benchmark01

A reproducible benchmark for asking an AI to recreate one schematic at a time
from [`bshada/open-schematics`](https://huggingface.co/datasets/bshada/open-schematics)
using tscircuit.

The harness keeps the task inputs separate from the reference metadata, creates
an isolated directory for every attempt, and produces a machine-readable score.

## Quick start

```sh
bun install

# Download one dataset row and prepare its public task fixture.
bun benchmark:fetch --row 0

# Create an isolated trial for that case.
bun benchmark:new --case 000000

# Put the attempted recreation in the printed candidate/ directory, then score it.
bun benchmark:score --trial trials/000000/<trial-id>
```

The candidate directory may contain:

- `manifest.json` — normalized components and nets (recommended; schema below)
- `circuit.json` — tscircuit Circuit JSON; components and nets are extracted
  automatically when no manifest is supplied
- `schematic.png` — enables the multimodal model-judge score
- source files such as `index.tsx` and notes about the model/run

The AI should only receive `task/`, not `.benchmark/`. The latter contains the
held-back reference metadata used by the scorer.

## Candidate manifest

```json
{
  "components": [
    { "reference": "R1", "type": "R", "value": "10k" },
    { "reference": "C1", "type": "C", "value": "100nF" }
  ],
  "nets": [
    { "name": "VCC", "members": ["R1.1", "C1.1"] }
  ]
}
```

Reference designators are ignored when matching components, so harmless
renumbering is not penalized. Net names are also ignored; nets are compared by
their connected `reference.pin` members.

## Score

The total score is intentionally decomposed instead of hiding quality behind a
single opaque number:

- **components (60%)** — multiset F1 over normalized component type and value
- **connectivity (25%)** — multiset F1 over net membership, when reference and
  candidate net data are available
- **model judge (15%)** — repeated GPT-5.6 judgments of electrical equivalence
  from two PNG attachments, when both rendered images and API access are available

Unavailable optional dimensions are omitted and the remaining weights are
renormalized. A component score is always required. `score.json` records the
raw counts, each dimension, effective weights, warnings, and provenance.

The dataset's generated JSON currently exposes component instances but not pin
connectivity, so automatically fetched cases usually begin with component and
model-judge scoring. A case curator can add normalized `nets` to
`.benchmark/reference.json` to enable connectivity scoring without changing the
trial format.

## Commands

```sh
bun benchmark:fetch --row 123 --force
bun benchmark:new --case 000123 --label gpt-5
bun benchmark:score --trial trials/000123/gpt-5
bun benchmark:score --trial trials/000123/gpt-5 --judge-runs 3 --model gpt-5.6
bun eval:judge
bun test
bun run check
```

`benchmark:fetch` uses the Hugging Face dataset server and stores dataset name,
split, row number, source repository, and a SHA-256 digest for reproducibility.
It does not commit large samples by default; `cases/` and `trials/` are ignored.

## Fair-run protocol

1. A benchmark operator fetches a case.
2. The agent is given only the created trial's `task/` and `candidate/` paths.
3. The agent writes its recreation without access to `.benchmark/`.
4. The operator runs the scorer after the agent finishes.
5. Preserve `score.json`, model name, prompt, token/runtime data, and git SHA.

The source dataset is CC-BY-4.0 and aggregates upstream projects that may carry
their own licenses. Keep attribution and review upstream licensing before
redistributing source files.

## Multimodal judge

The judge receives only two PNG data attachments and a rubric. It never receives
SVG, Circuit JSON, manifests, filenames, or the expected answer. Image order is
randomized independently on every call and the default score averages three
calls. The raw verdicts, differences, confidence, response IDs, image order, and
vote agreement are retained in `score.json`. The benchmark uses the fraction of
`sameCircuit` votes as its model-judge score. The model's self-reported
continuous similarity is diagnostic only because the validation suite found it
poorly calibrated for subtle but real changes.

`OPENAI_API_KEY` is required. `gpt-5.6` is the default; use `--model` or
`OPENAI_JUDGE_MODEL` to pin another vision-capable model.

`bun eval:judge` creates a six-pair synthetic validation set, rasterizes all SVG
fixtures to PNG before submission, and measures accuracy on three style-only
equivalents plus three real changes (value, connectivity, and extra load). Set
`JUDGE_REPEATS` to control repeated calls. Results are written under
`eval-results/judge/` and are intentionally ignored by git because they contain
API response IDs and time-dependent evaluation output.
