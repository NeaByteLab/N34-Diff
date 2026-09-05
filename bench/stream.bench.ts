import N34 from '@neabyte/n34-diff'

/**
 * Stream bench spec loaded from tests/edge JSON.
 * @description Holds section label and chunked stream input.
 */
type StreamSpec = {
  /** Bench section label */
  section: string
  /** Source text before edit */
  original: string
  /** Edit split into push chunks */
  chunks: string[]
  /** Expected concatenated after output */
  expectedFinal: string
  /** Expected number of emitted hunks */
  expectedHunkCount?: number
  /** Attach callback before first push */
  registerCallbackBeforePush?: boolean
}

/**
 * Apply-only edge spec loaded from tests/edge JSON.
 * @description Filtered away for stream bench purposes.
 */
type EdgeSpec = StreamSpec | { section: string }

/**
 * Check if spec has chunks.
 * @description Narrows EdgeSpec to StreamSpec by property check.
 * @param spec - Edge spec to inspect
 * @returns True when spec is StreamSpec
 */
function hasChunks(spec: EdgeSpec): spec is StreamSpec {
  return 'chunks' in spec
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

/** Stream chunk specs from tests/edge JSON files */
const streamSpecs = (await loadDir<EdgeSpec>('../tests/edge/')).filter(hasChunks)

Deno.bench({
  name: `stream corpus - ${streamSpecs.length} specs`,
  group: 'stream-corpus',
  baseline: true,
  fn() {
    for (const spec of streamSpecs) {
      const handle = N34.stream(spec.original)
      handle.callback(() => {})
      for (const chunk of spec.chunks) {
        handle.push(chunk)
      }
      handle.end()
    }
  }
})

/** Per-spec stream bench for chunk-shape hotspot inspection */
for (const spec of streamSpecs) {
  Deno.bench({
    name: `stream - ${spec.section}`,
    group: 'stream-spec',
    fn() {
      const handle = N34.stream(spec.original)
      handle.callback(() => {})
      for (const chunk of spec.chunks) {
        handle.push(chunk)
      }
      handle.end()
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

/**
 * Split text into fixed-size chunks.
 * @description Slices UTF-16 code units at width boundaries.
 * @param text - Text payload to split
 * @param width - Chunk width in code units
 * @returns Array of chunk strings
 */
function chunkFixed(text: string, width: number): string[] {
  if (width <= 0) {
    return [text]
  }
  const chunks: string[] = []
  for (let offset = 0; offset < text.length; offset += width) {
    chunks.push(text.slice(offset, offset + width))
  }
  return chunks
}

/** Synthetic scaling ladder for stream throughput */
const scaleSizes = [64, 256, 1024, 4096] as const
/** Chunk widths mimicking LLM token delivery cadence */
const chunkWidths = [1, 16, 256] as const

for (const lines of scaleSizes) {
  const original = makeSource(lines)
  const edit = makeEdit(lines)
  for (const width of chunkWidths) {
    const chunks = chunkFixed(edit, width)
    Deno.bench({
      name: `stream scale - ${lines} lines, chunk=${width}`,
      group: `stream-scale-${lines}`,
      fn() {
        const handle = N34.stream(original)
        handle.callback(() => {})
        for (const chunk of chunks) {
          handle.push(chunk)
        }
        handle.end()
      }
    })
  }
}
