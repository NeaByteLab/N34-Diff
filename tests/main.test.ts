import * as Assert from '@std/assert'
import N34 from '@neabyte/n34-diff'

/**
 * Apply test case from JSON.
 * @description Holds section label and input-output pair.
 */
type ApplySpec = {
  /** Test section label */
  section: string
  /** Source text before edit */
  original: string
  /** Edit script with markers */
  edit: string
  /** Expected output after apply */
  expected: string
}

/**
 * Stream test case from JSON.
 * @description Holds chunked input and expected final output.
 */
type StreamSpec = {
  /** Test section label */
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

/** Union of stream and apply specs */
type EdgeSpec = StreamSpec | ApplySpec

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
 * Build hunk listener into sink.
 * @description Returns callback that pushes after text to array.
 * @param sink - Array to collect after strings
 * @returns Listener function for stream callback
 */
function collector(sink: string[]) {
  return (patch: { after: string }) => {
    sink.push(patch.after)
  }
}

/**
 * Load JSON specs from directory.
 * @description Reads and sorts all JSON files alphabetically.
 * @param relative - Relative directory path from test file
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

/** Apply specs from tests/code JSON files */
for (const spec of await loadDir<ApplySpec>('./code/')) {
  Deno.test(`apply - ${spec.section}`, () => {
    Assert.assertEquals(N34.apply(spec.original, spec.edit).after, spec.expected)
  })
}

/** Edge specs from tests/edge JSON files */
const edgeSpecs = await loadDir<EdgeSpec>('./edge/')

/** Stream chunk edge cases */
for (const spec of edgeSpecs.filter(hasChunks)) {
  Deno.test(`stream - ${spec.section}`, () => {
    const sink: string[] = []
    const handle = N34.stream(spec.original)
    const early = spec.registerCallbackBeforePush !== false
    if (early) {
      handle.callback(collector(sink))
    }
    for (const chunk of spec.chunks) {
      handle.push(chunk)
    }
    handle.end()
    if (!early) {
      handle.callback(collector(sink))
    }
    Assert.assertEquals(sink.join(''), spec.expectedFinal)
    if (typeof spec.expectedHunkCount === 'number') {
      Assert.assertEquals(sink.length, spec.expectedHunkCount)
    }
  })
}

/** Stream parity with apply edge cases */
for (const spec of edgeSpecs.filter((edge): edge is ApplySpec => !hasChunks(edge))) {
  Deno.test(`stream parity - ${spec.section}`, () => {
    const sink: string[] = []
    const handle = N34.stream(spec.original)
    handle.callback(collector(sink))
    handle.push(spec.edit)
    handle.end()
    Assert.assertEquals(sink.join(''), spec.expected)
  })
}

Deno.test('stream backlog - late callback replays in order', () => {
  const source = 'q-a\nq-b\nq-c\n'
  const edit = '<<<<<<< SKIP\nq-a\nq-b changed "<<<<<<< SKIP inert"\nq-c\n<<<<<<< SKIP\n'
  const expected = N34.apply(source, edit).after
  const handle = N34.stream(source)
  handle.push(edit)
  handle.end()
  const sink: string[] = []
  handle.callback(collector(sink))
  Assert.assertEquals(sink.join(''), expected)
})

Deno.test('stream chunk - CRLF split across boundary reassembles', () => {
  const source = 'r-a\nr-b\nr-c\n'
  const expected = N34.apply(source, '<<<<<<< SKIP\nr-a\nr-b changed\nr-c\n<<<<<<< SKIP\n').after
  const sink: string[] = []
  const handle = N34.stream(source)
  handle.callback(collector(sink))
  handle.push('<<<<<<< SKIP\r')
  handle.push('\nr-a\r\nr-b changed\r')
  handle.push('\nr-c\r\n<<<<<<< SKIP\r\n')
  handle.end()
  Assert.assertEquals(sink.join(''), expected)
})

Deno.test('stream chunk - byte-per-byte equals full push', () => {
  const source = 'row-a\nrow-b\nrow-c\n'
  const edit = '<<<<<<< SKIP\nrow-a\nrow-b changed "<<<<<<< SKIP inert"\nrow-c\n<<<<<<< SKIP\n'
  const expected = N34.apply(source, edit).after
  const sink: string[] = []
  const handle = N34.stream(source)
  handle.callback(collector(sink))
  for (const character of edit) {
    handle.push(character)
  }
  handle.end()
  Assert.assertEquals(sink.join(''), expected)
})

Deno.test('stream chunk - empty push is silently ignored', () => {
  const source = 'a\nb\n'
  const edit = '<<<<<<< SKIP\na\nb replaced "<<<<<<< SKIP inert"\n<<<<<<< SKIP\n'
  const expected = N34.apply(source, edit).after
  const sink: string[] = []
  const handle = N34.stream(source)
  handle.callback(collector(sink))
  handle.push('')
  handle.push('<<<<<<< SKIP\n')
  handle.push('')
  handle.push('a\nb replaced "<<<<<<< SKIP inert"\n<<<<<<< SKIP\n')
  handle.push('')
  handle.end()
  Assert.assertEquals(sink.join(''), expected)
})

Deno.test('stream chunk - trailing hunk without close marker flushes', () => {
  const source = 't-a\nt-b\n'
  const expected = N34.apply(source, '<<<<<<< SKIP\nt-a modified "<<<<<<< SKIP inert"\nt-b\n').after
  const sink: string[] = []
  const handle = N34.stream(source)
  handle.callback(collector(sink))
  handle.push('<<<<<<< SKIP\nt-a modified "<<<<<<< SKIP inert"\nt-b\n')
  handle.end()
  Assert.assertEquals(sink.join(''), expected)
})

Deno.test('stream lifecycle - end before any push emits nothing', () => {
  const sink: string[] = []
  const handle = N34.stream('a\nb\n')
  handle.callback(collector(sink))
  handle.end()
  Assert.assertEquals(sink.length, 0)
})

Deno.test('stream lifecycle - end is idempotent', () => {
  const handle = N34.stream('a\nb\n')
  handle.callback(() => {})
  handle.end()
  handle.end()
})

Deno.test('stream lifecycle - later callback overwrites earlier', () => {
  const first: string[] = []
  const second: string[] = []
  const source = 'a\nb\n'
  const edit = '<<<<<<< SKIP\na\nb replaced with "<<<<<<< SKIP inert"\n<<<<<<< SKIP\n'
  const expected = N34.apply(source, edit).after
  const handle = N34.stream(source)
  handle.callback(collector(first))
  handle.callback(collector(second))
  handle.push(edit)
  handle.end()
  Assert.assertEquals(first.length, 0)
  Assert.assertEquals(second.join(''), expected)
})

Deno.test('stream lifecycle - non-function callback throws TypeError', () => {
  const handle = N34.stream('a\nb\n')
  Assert.assertThrows(() => handle.callback('nope' as unknown as null), TypeError)
  handle.end()
})

Deno.test('stream lifecycle - non-string chunk throws TypeError', () => {
  const handle = N34.stream('a\nb\n')
  handle.callback(() => {})
  Assert.assertThrows(() => handle.push(123 as unknown as string), TypeError)
  handle.end()
})

Deno.test('stream lifecycle - null callback buffers until reattach', () => {
  const sink: string[] = []
  const source = 'a\nb\n'
  const edit = '<<<<<<< SKIP\na\nb replaced with "<<<<<<< skip inert"\n<<<<<<< SKIP\n'
  const expected = N34.apply(source, edit).after
  const handle = N34.stream(source)
  handle.callback(null)
  handle.push(edit)
  handle.end()
  handle.callback(collector(sink))
  Assert.assertEquals(sink.join(''), expected)
})

Deno.test('stream lifecycle - push after end throws TypeError', () => {
  const handle = N34.stream('a\nb\n')
  handle.callback(() => {})
  handle.end()
  Assert.assertThrows(() => handle.push('<<<<<<< SKIP\n'), TypeError)
})

Deno.test('stream parity - apply and stream produce identical after', () => {
  const source = 'p-a\np-b\np-c\np-d\n'
  const edit =
    `<<<<<<< SKIP\n<<<<<<< skip\np-a\np-b changed "<<<<<<< SKIP" + curly \u201Chi\u201D\np-c\n\tp-c-tab tab-indent extra\np-d\n<<<<<<< Skip\n`
  const expected = N34.apply(source, edit).after
  const sink: string[] = []
  const handle = N34.stream(source)
  handle.callback(collector(sink))
  handle.push(edit)
  handle.end()
  Assert.assertEquals(sink.join(''), expected)
})

Deno.test('stream timeout - Infinity is accepted', () => {
  const source = 'a\nb\n'
  const edit = '<<<<<<< SKIP\na\nb changed "<<<<<<< SKIP inert"\n<<<<<<< SKIP\n'
  const expected = N34.apply(source, edit).after
  const handle = N34.stream(source, { timeout: Number.POSITIVE_INFINITY })
  const sink: string[] = []
  handle.callback(collector(sink))
  handle.push(edit)
  handle.end()
  Assert.assertEquals(sink.join(''), expected)
})

Deno.test('stream timeout - NaN throws RangeError', () => {
  Assert.assertThrows(() => N34.stream('a\nb\n', { timeout: Number.NaN }), RangeError)
})

Deno.test('stream timeout - negative rejects at construction', () => {
  Assert.assertThrows(() => N34.stream('a\nb\n', { timeout: -1 }), RangeError)
})

Deno.test('stream timeout - zero timeout eagerly rejects push', () => {
  const handle = N34.stream('a\nb\n', { timeout: 0 })
  Assert.assertThrows(() => handle.push('<<<<<<< SKIP\n'), RangeError)
})

Deno.test('stream typecheck - non-string original throws TypeError', () => {
  Assert.assertThrows(() => N34.stream(42 as unknown as string), TypeError)
})
