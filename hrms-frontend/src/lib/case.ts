const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype

export const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => String(c).toUpperCase())

export const camelize = (input: unknown): unknown => {
  if (Array.isArray(input)) return input.map(camelize)
  if (!isPlainObject(input)) return input

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    out[snakeToCamel(k)] = camelize(v)
  }
  return out
}

