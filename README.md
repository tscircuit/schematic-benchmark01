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

# Put index.circuit.tsx in candidate/, then score it.
bun benchmark:score --trial trials/000000/<trial-id>
```

The candidate directory contains source code, with `index.circuit.tsx` as the
default entrypoint. Candidate-generated Circuit JSON, manifests, SVGs, and PNGs
are never used for scoring.

The AI should only receive `task/`, not `.benchmark/`. The latter contains the
held-back reference metadata used by the scorer.

## Source-only constraint

This benchmark measures whether declarative tscircuit TSX can express each
schematic. Candidates must use components and `<trace>` connectivity.
`<schematicline>` and `<netlabel>` are forbidden because they can manually draw
the expected appearance without demonstrating that component placement and
connectivity produce the schematic.

Before scoring, the harness:

1. audits all candidate JavaScript and TypeScript source;
2. deletes every previous `candidate/dist` artifact;
3. runs `tsci build` itself with API credentials removed from the environment;
4. copies the untouched Circuit JSON and schematic SVG to `trial/generated/`;
5. rasterizes that SVG to PNG itself; and
6. records SHA-256 hashes for TSX, Circuit JSON, SVG, and PNG.

Only `generated/` artifacts are scored. Post-processing scripts and files left
in `candidate/` cannot influence the result.

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
bun benchmark:build --trial trials/000123/gpt-5
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
3. The agent writes TSX without access to `.benchmark/`.
4. The operator runs the scorer, which audits and independently rebuilds it.
5. Preserve `score.json`, `generated/provenance.json`, model name,
   prompt, token/runtime data, and git SHA.

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
