import N34 from '@neabyte/n34-diff'

/**
 * Apply bench spec loaded from tests/code JSON.
 * @description Holds section label and full apply input-output pair.
 */
type ApplySpec = {
  /** Bench section label */
  section: string
  /** Source text before edit */
  original: string
  /** Edit script with markers */
  edit: string
  /** Expected output after apply */
  expected: string
}

/**
 * Load JSON specs from directory.
 * @description Reads and sorts JSON files alphabetically by section.
 * @param relative - Relative directory path from bench file
 * @returns Sorted array of parsed spec objects
 * @template T - Spec type with section field
 */
async function loadDir<T extends { section: string }>(relative: string): Promise<T[]> {
  const specs: T[] = []
  const url = new URL(relative, import.meta.url)
  for await (const entry of Deno.readDir(url)) {
    if (!entry.isFile || !entry.name.endsWith('.json')) {
      continue
    }
    const parsed = JSON.parse(await Deno.readTextFile(new URL(entry.name, url))) as T | T[]
    if (Array.isArray(parsed)) {
      specs.push(...parsed)
    } else {
      specs.push(parsed)
    }
  }
  return specs.sort((left, right) => left.section.localeCompare(right.section))
}

/** Language corpus specs from tests/code JSON files */
const codeSpecs = await loadDir<ApplySpec>('../tests/code/')

/** Total corpus payload size in bytes for baseline visibility */
const corpusBytes = codeSpecs.reduce(
  (total, spec) => total + spec.original.length + spec.edit.length,
  0
)

Deno.bench({
  name: `apply corpus - ${codeSpecs.length} langs, ${corpusBytes} bytes`,
  group: 'apply-corpus',
  baseline: true,
  fn() {
    for (const spec of codeSpecs) {
      N34.apply(spec.original, spec.edit)
    }
  }
})

/** Per-language apply bench for hotspot inspection */
for (const spec of codeSpecs) {
  Deno.bench({
    name: `apply - ${spec.section}`,
    group: 'apply-lang',
    fn() {
      N34.apply(spec.original, spec.edit)
    }
  })
}

/**
 * Build synthetic source of the given line count.
 * @description Emits deterministic numbered lines.
 * @param lines - Line count to produce
 * @returns Source string terminated by newline
 */
function makeSource(lines: number): string {
  const rows: string[] = []
  for (let index = 0; index < lines; index += 1) {
    rows.push(`row-${index} value=${index * 3}`)
  }
  return `${rows.join('\n')}\n`
}

/**
 * Build edit body that touches a mid-file line.
 * @description Wraps a single hunk between SKIP markers.
 * @param lines - Line count of the source
 * @returns Edit string with one changed line
 */
function makeEdit(lines: number): string {
  const mid = Math.floor(lines / 2)
  return [
    '<<<<<<< SKIP',
    `row-${mid - 1} value=${(mid - 1) * 3}`,
    `row-${mid} value=${mid * 3} patched "<<<<<<< SKIP inert"`,
    `row-${mid + 1} value=${(mid + 1) * 3}`,
    '<<<<<<< SKIP',
    ''
  ].join('\n')
}

/** Synthetic scaling ladder for apply throughput */
const scaleSizes = [64, 256, 1024, 4096] as const

for (const lines of scaleSizes) {
  const original = makeSource(lines)
  const edit = makeEdit(lines)
  Deno.bench({
    name: `apply scale - ${lines} lines`,
    group: 'apply-scale',
    fn() {
      N34.apply(original, edit)
    }
  })
}
