import type { Component, Manifest, Net } from "./types"

const clean = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")

const passiveTypeAliases: Record<string, string> = {
  r: "resistor",
  c: "capacitor",
  l: "inductor",
}

const canonicalComponentType = (type: string) => {
  const normalized = clean(type).replace(/^simple_/, "")
  return passiveTypeAliases[normalized] ?? normalized
}

export const componentKey = (component: Component) =>
  `${canonicalComponentType(component.type)}|${clean(component.value)}`

export const netKey = (net: Net) =>
  [...new Set(net.members.map(clean).filter(Boolean))].sort().join("|")

const property = (properties: unknown, key: string) => {
  if (!Array.isArray(properties)) return undefined
  const item = properties.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      clean((entry as Record<string, unknown>).key) === clean(key),
  ) as Record<string, unknown> | undefined
  return item?.value === undefined ? undefined : String(item.value)
}

export function manifestFromOpenSchematicsJson(raw: string): Manifest {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const symbols = Array.isArray(parsed.schematicSymbols)
    ? parsed.schematicSymbols
    : []
  const components = symbols.flatMap((symbol): Component[] => {
    if (typeof symbol !== "object" || symbol === null) return []
    const item = symbol as Record<string, unknown>
    const type = String(item.entryName ?? item.libraryNickname ?? "unknown")
    return [
      {
        reference: property(item.properties, "Reference"),
        type,
        value: property(item.properties, "Value") ?? type,
      },
    ]
  })
  if (components.length === 0) {
    throw new Error("dataset row has no schematicSymbols to score")
  }
  return { components }
}

export function manifestFromCircuitJson(raw: unknown): Manifest {
  if (!Array.isArray(raw)) throw new Error("circuit.json must be an array")
  const records = raw.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null,
  )
  const sources = records.filter((item) => item.type === "source_component")
  const ports = new Map(
    records
      .filter((item) => item.type === "source_port")
      .map((port) => [String(port.source_port_id), port]),
  )
  const componentById = new Map(
    sources.map((component) => [String(component.source_component_id), component]),
  )
  const components = sources.map((component): Component => ({
    reference: stringField(component, "name", "reference", "refdes"),
    type:
      stringField(component, "ftype", "component_type", "name") ?? "unknown",
    value: stringField(
      component,
      "resistance",
      "capacitance",
      "inductance",
      "value",
      "name",
    ),
  }))
  const nets = records
    .filter((item) => item.type === "source_trace")
    .flatMap((trace): Net[] => {
      const ids = trace.connected_source_port_ids
      if (!Array.isArray(ids)) return []
      const members = ids.flatMap((id): string[] => {
        const port = ports.get(String(id))
        if (!port) return []
        const component = componentById.get(String(port.source_component_id))
        const reference = component
          ? stringField(component, "name", "reference", "refdes")
          : undefined
        const pin = stringField(port, "pin_number", "port_hints", "name")
        return reference && pin ? [`${reference}.${pin}`] : []
      })
      return members.length > 1 ? [{ members }] : []
    })
  if (components.length === 0) {
    throw new Error("circuit.json has no source_component records")
  }
  return { components, nets }
}

function stringField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" || typeof value === "number") {
      return String(value)
    }
    if (Array.isArray(value) && value.length > 0) return String(value[0])
  }
  return undefined
}
