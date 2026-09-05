/**
 * Anchor match location and coverage span.
 * @description Result of matcher pinpointing hunk to source range.
 */
export type AnchorHit = {
  /** Zero-based source line where match starts */
  sourceStart: number
  /** Match end source line, exclusive */
  sourceEnd: number
  /** Anchored line pair count */
  chainLength: number
  /** Zero-based hunk index of chain head */
  hunkHead: number
  /** Zero-based hunk index of chain tail */
  hunkTail: number
}

/**
 * Candidate anchor pair for matching.
 * @description One equivalent line pair before chain selection.
 */
export type AnchorPair = {
  /** Zero-based line index inside hunk */
  hunkIndex: number
  /** Zero-based line index inside source */
  sourceIndex: number
}

/**
 * Options for a single apply call.
 * @description Runtime knobs consumers may pass to apply.
 */
export type ApplyOption = {
  /** Optional timeout in milliseconds */
  timeout?: number
}

/**
 * Result bundle from applying an edit.
 * @description Bundle of original text, patched text, and diff.
 */
export type ApplyResult = {
  /** Original source before applying edit */
  before: string
  /** Patched source after applying edit */
  after: string
  /** Structured line-by-line diff records */
  diff: DiffLine[]
}

/**
 * Assembled output plus hunk boundaries.
 * @description Return shape of Pipeline.assemble merge step.
 */
export type AssembleResult = {
  /** Merged output lines in source order */
  output: string[]
  /** Output line count per hunk end */
  hunkEnd: number[]
}

/** Canonicalization mode used by the matcher */
export type CanonMode = 'anchor' | 'soft'

/**
 * Traversal frame during chain enumeration.
 * @description Path accumulator used by longest chain search.
 */
export type ChainFrame = {
  /** Node indices visited so far */
  path: number[]
  /** Current node index being expanded */
  node: number
}

/**
 * Wall-clock deadline window for apply.
 * @description Start time paired with elapsed budget in milliseconds.
 */
export type DeadlineWindow = {
  /** performance.now value at start */
  start: number
  /** Timeout budget in milliseconds */
  limit: number
}

/**
 * One record inside the structured diff.
 * @description Add, delete, or equal line with position data.
 */
export type DiffLine = {
  /** Kind of change for this line */
  type: DiffType
  /** Line content without trailing newline */
  value: string
  /** Source line number or null */
  oldLine: number | null
  /** Output line number or null */
  newLine: number | null
}

/** Change kind for diff line */
export type DiffType = 'add' | 'delete' | 'equal'

/**
 * One parsed edit segment.
 * @description Hunk of new lines or keep marker.
 */
export type EditSegment = {
  /** Segment kind selected by parser */
  kind: SegmentKind
  /** Line contents inside the segment */
  lines: string[]
}

/**
 * Line-by-line segmenter for edit bodies.
 * @description Feed lines and flush to obtain edit segments.
 */
export type EditSegmenter = {
  /** Feed one edit line */
  feed(line: string): void
  /** Flush and return segments */
  flush(): EditSegment[]
  /** Segments collected so far */
  segments: readonly EditSegment[]
}

/** Listener invoked per resolved hunk */
export type HunkListener = (hunk: ApplyResult) => void

/**
 * Resolved placement of one hunk.
 * @description Source span paired with match quality tier.
 */
export type HunkPlacement = {
  /** Source span the hunk replaces */
  spot: HunkSpot
  /** Quality tier assigned to this placement */
  quality: MatchQuality
  /** Zero-based first anchored hunk line */
  hunkHead: number
  /** Zero-based last anchored hunk line */
  hunkTail: number
}

/**
 * Source span replaced by a hunk.
 * @description Line range plus new hunk lines to insert.
 */
export type HunkSpot = {
  /** Zero-based source line where span starts */
  sourceStart: number
  /** Span end source line, exclusive */
  sourceEnd: number
  /** New lines emitted for this span */
  lines: string[]
}

/**
 * Idle timer for stream scheduler.
 * @description Clear and reset controls for the stream deadline.
 */
export type IdleTimer = {
  /** Cancel the pending idle timer */
  clear(): void
  /** Rearm the idle timer from now */
  reset(): void
}

/** Confidence tier for hunk placement */
export type MatchQuality = 'gapfill' | 'partial' | 'full'

/** Scan step direction for neighbor lookup */
export type ScanDirection = -1 | 1

/** Parser segment kind marker */
export type SegmentKind = 'keep' | 'hunk'

/**
 * Handle returned by N34.stream.
 * @description Register callback, push chunks, and end the stream.
 */
export type StreamHandle = {
  /** Register or clear hunk listener */
  callback(listener: HunkListener | null): void
  /** End stream and flush hunks */
  end(): void
  /** Feed a chunk of edit text */
  push(chunk: string): void
}

/**
 * Internal state carried through a stream.
 * @description Buffers, flags, and listener wiring for stream core.
 */
export type StreamState = {
  /** Pending text buffer between newlines */
  buffer: string
  /** True when last chunk ended CR */
  pendingCR: boolean
  /** Segmenter accumulating edit segments */
  segmenter: EditSegmenter
  /** Patches queued before listener attached */
  backlog: ApplyResult[]
  /** Registered patch listener or null */
  callback: HunkListener | null
  /** True when the stream is closed */
  closed: boolean
  /** True after idle timeout elapsed */
  timedOut: boolean
  /** True after the first push arrived */
  pushed: boolean
  /** True after a listener callback threw */
  errored: boolean
}
