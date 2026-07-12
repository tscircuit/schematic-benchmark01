import { expect, test } from "bun:test"
import { assertNoManualSchematicElements, assertSourceOnlyTsx } from "../src/build-candidate"

test("accepts declarative traces and rejects manual schematic drawing primitives", () => {
  expect(() => assertSourceOnlyTsx("export default () => <board><resistor name='R1' /><trace from='.R1 > .pin1' to='net.GND' /></board>")).not.toThrow()
  expect(() => assertSourceOnlyTsx("export default () => <schematicline x1={0} y1={0} x2={1} y2={1} />", "line.tsx")).toThrow("forbidden <schematicline>")
  expect(() => assertSourceOnlyTsx("export default () => <netlabel net='GND' />", "label.tsx")).toThrow("forbidden <netlabel>")
  expect(() => assertSourceOnlyTsx("export default () => <  NetLabel net='GND' />", "case.tsx")).toThrow("forbidden <NetLabel>")
})

test("rejects schematic lines emitted through indirect JSX", () => {
  expect(() => assertNoManualSchematicElements([{ type: "source_component" }, { type: "schematic_line" }])).toThrow("manual schematic drawing is forbidden")
  expect(() => assertNoManualSchematicElements([{ type: "source_component" }, { type: "schematic_trace" }])).not.toThrow()
})
