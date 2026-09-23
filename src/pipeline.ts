import type * as Types from '@app/types.ts'
import Matcher from '@app/matcher.ts'
import Quote from '@app/quote.ts'

/**
 * Placement pipeline for edit hunks.
 * @description Locates hunks then assembles the merged output.
 */
export default class Pipeline {
  /**
   * Assemble patched output from placements.
   * @description Merges keep spans and hunk replacements in order.
   * @param segments - Parsed edit segments
   * @param source - Source lines being patched
   * @param placements - Resolved hunk placements per segment
   * @param indexes - Indexes of hunk segments inside segments
   * @returns Merged output plus per-hunk end positions
   */
  static assemble(
    segments: Types.EditSegment[],
    source: string[],
    placements: Types.HunkPlacement[],
    indexes: number[]
  ): Types.AssembleResult {
    const output: string[] = []
    const stops: number[] = new Array(indexes.length)
    const length = source.length
    let cursor = 0
    let step = 0
    for (const segment of segments) {
      if (segment.kind === 'keep') {
        const next = step < indexes.length ? placements[indexes[step]!]!.spot.sourceStart : length
        if (cursor < next) {
          for (let mark = cursor; mark < next; mark += 1) {
            output.push(source[mark]!)
          }
          cursor = next
        } else if (step > 0 && step < indexes.length) {
          for (const indent of segment.lines) {
            if (indent.length > 0) {
              output.push(indent)
            }
          }
        }
        continue
      }
      const spot = placements[indexes[step]!]!.spot
      for (let mark = cursor; mark < spot.sourceStart; mark += 1) {
        output.push(source[mark]!)
      }
      const span = spot.sourceEnd - spot.sourceStart
      for (let rank = 0; rank < spot.lines.length; rank += 1) {
        const target = span === 0 ? '' : source[spot.sourceStart + Math.min(rank, span - 1)]!
        output.push(Quote.restyle(spot.lines[rank]!, target))
      }
      cursor = Math.max(cursor, spot.sourceEnd)
      stops[step] = output.length
      step += 1
    }
    return { hunkEnd: stops, output }
  }

  /**
   * Throw when deadline window elapsed.
   * @description Compares elapsed time against the deadline limit.
   * @param deadline - Deadline window or null to skip check
   * @throws RangeError When the deadline budget has elapsed
   */
  static checkDeadline(deadline: Types.DeadlineWindow | null): void {
    if (!deadline) {
      return
    }
    const elapsed = performance.now() - deadline.start
    if (elapsed >= deadline.limit) {
      throw new RangeError(
        `timeout budget of ${deadline.limit}ms elapsed after ${elapsed.toFixed(0)}ms`
      )
    }
  }

  /**
   * Collect indexes of hunk segments.
   * @description Scans segments and records positions of hunks.
   * @param segments - Parsed edit segments to scan
   * @returns Ordered indexes of hunk segments
   */
  static collectHunks(segments: Types.EditSegment[]): number[] {
    const indexes: number[] = []
    for (let index = 0; index < segments.length; index += 1) {
      if (segments[index]!.kind === 'hunk') {
        indexes.push(index)
      }
    }
    return indexes
  }

  /**
   * Extend boundary hunks to source edges.
   * @description Snaps first and last hunk spans when keeps missing.
   * @param placements - Resolved placements array by segment index
   * @param segments - Parsed edit segments
   * @param source - Source lines used for edge alignment
   * @param indexes - Indexes of hunk segments inside segments
   */
  static extendBoundary(
    placements: (Types.HunkPlacement | null)[],
    segments: Types.EditSegment[],
    source: string[],
    indexes: number[]
  ): void {
    const first = indexes[0]!
    const last = indexes[indexes.length - 1]!
    if (segments[0]!.kind !== 'keep' && placements[first]!.quality !== 'gapfill') {
      placements[first]!.spot.sourceStart = 0
    }
    if (segments[segments.length - 1]!.kind !== 'keep' && placements[last]!.quality !== 'gapfill') {
      placements[last]!.spot.sourceEnd = source.length
    }
  }

  /**
   * Fill placements missing after anchor pass.
   * @description Derives spans from neighbor edges and keep flags.
   * @param placements - Resolved placements array by segment index
   * @param segments - Parsed edit segments
   * @param source - Source lines used for gap derivation
   * @param indexes - Indexes of hunk segments inside segments
   * @throws RangeError When neighbor edges yield a negative span
   */
  static fillGaps(
    placements: (Types.HunkPlacement | null)[],
    segments: Types.EditSegment[],
    source: string[],
    indexes: number[]
  ): void {
    const length = source.length
    for (let step = 0; step < indexes.length; step += 1) {
      const index = indexes[step]!
      if (placements[index]) {
        continue
      }
      const before = index > 0 && segments[index - 1]!.kind === 'keep'
      const after = index + 1 < segments.length && segments[index + 1]!.kind === 'keep'
      const tail = this.neighborEdge(placements, indexes, step, -1)
      const next = this.neighborEdge(placements, indexes, step, 1)
      let start: number
      let end: number
      if (tail === null && next === null && before && after) {
        start = 0
        end = length
      } else {
        start = tail ?? (before ? length : 0)
        end = next ?? (after ? 0 : length)
        if (end < start) {
          throw new RangeError(
            `apply hunk ${step} derived a negative span from ${start} to ${end} from reordered neighbors`
          )
        }
      }
      if (before && start < end && Matcher.isBlank(source[start] ?? '')) {
        start += 1
      }
      if (after && end > start && Matcher.isBlank(source[end - 1] ?? '')) {
        end -= 1
      }
      if (end < start) {
        end = start
      }
      placements[index] = {
        hunkHead: 0,
        hunkTail: segments[index]!.lines.length - 1,
        quality: 'gapfill',
        spot: { lines: segments[index]!.lines, sourceEnd: end, sourceStart: start }
      }
    }
  }

  /**
   * Grow hunk span backward.
   * @description Absorbs kin lines and skips blank hops until floor.
   * @param spot - Hunk spot being widened backward
   * @param source - Source lines to compare against
   * @param hunk - Hunk lines used for kin comparison
   * @param probe - Starting hunk index moving backward
   * @param floor - Lower bound the source cursor may reach
   */
  static growBackward(
    spot: Types.HunkSpot,
    source: string[],
    hunk: string[],
    probe: number,
    floor: number
  ): void {
    let cursor = probe
    while (cursor >= 0 && spot.sourceStart > floor) {
      const mark = spot.sourceStart - 1
      const line = source[mark]!
      const goal = hunk[cursor]!
      if (Matcher.kin(line, goal)) {
        spot.sourceStart -= 1
        cursor -= 1
        continue
      }
      const hop = mark - 1
      if (Matcher.isBlank(line) && hop >= floor && Matcher.kin(source[hop]!, goal)) {
        spot.sourceStart -= 2
        cursor -= 1
        continue
      }
      return
    }
  }

  /**
   * Grow hunk span forward.
   * @description Absorbs kin lines and skips blank hops until ceiling.
   * @param spot - Hunk spot being widened forward
   * @param source - Source lines to compare against
   * @param hunk - Hunk lines used for kin comparison
   * @param probe - Starting hunk index moving forward
   * @param ceiling - Upper bound the source cursor may reach
   */
  static growForward(
    spot: Types.HunkSpot,
    source: string[],
    hunk: string[],
    probe: number,
    ceiling: number
  ): void {
    let cursor = probe
    while (cursor < hunk.length && spot.sourceEnd < ceiling) {
      const mark = spot.sourceEnd
      const line = source[mark]!
      const goal = hunk[cursor]!
      if (Matcher.kin(line, goal)) {
        spot.sourceEnd += 1
        cursor += 1
        continue
      }
      const hop = mark + 1
      if (
        Matcher.isBlank(line) &&
        hop < ceiling &&
        Matcher.kin(source[hop]!, goal)
      ) {
        spot.sourceEnd += 2
        cursor += 1
        continue
      }
      return
    }
  }

  /**
   * Resolve final placements for every hunk.
   * @description Runs anchor and fuzzy passes then repairs the map.
   * @param segments - Parsed edit segments
   * @param source - Source lines being patched
   * @param indexes - Indexes of hunk segments inside segments
   * @param deadline - Deadline window or null to skip check
   * @returns Placements array aligned with segments length
   * @throws SyntaxError When a hunk cannot be anchored or overlaps
   * @throws RangeError When the deadline budget elapses
   */
  static locate(
    segments: Types.EditSegment[],
    source: string[],
    indexes: number[],
    deadline: Types.DeadlineWindow | null
  ): Types.HunkPlacement[] {
    const length = source.length
    const anchor = source.map((line) => Matcher.canonical(line, 'anchor'))
    const catalog = Matcher.anchorIndex(anchor)
    let cache: string[] | null = null
    const placements: (Types.HunkPlacement | null)[] = new Array(segments.length).fill(null)
    if (segments.length === 1 && indexes.length === 1) {
      const hunk = segments[indexes[0]!]!.lines
      placements[indexes[0]!] = {
        hunkHead: 0,
        hunkTail: hunk.length - 1,
        quality: 'full',
        spot: { lines: hunk, sourceEnd: length, sourceStart: 0 }
      }
      return placements as Types.HunkPlacement[]
    }
    let cursor = 0
    for (let step = 0; step < indexes.length; step += 1) {
      this.checkDeadline(deadline)
      const index = indexes[step]!
      const hunk = segments[index]!.lines
      const exact = hunk.map((line) => Matcher.canonical(line, 'anchor'))
      const soft = hunk.map((line) => Matcher.canonical(line, 'soft'))
      const hit = Matcher.anchor(hunk, exact, catalog, cursor, length) ??
        (Matcher.lengthReject(anchor, exact, cursor, length) ? null : Matcher.fuzzy(
          hunk,
          soft,
          cache ??= source.map((line) => Matcher.canonical(line, 'soft')),
          cursor,
          length
        ))
      if (!hit) {
        continue
      }
      const live = Matcher.countLive(hunk)
      placements[index] = {
        hunkHead: hit.hunkHead,
        hunkTail: hit.hunkTail,
        quality: live > 0 && hit.chainLength >= live ? 'full' : 'partial',
        spot: { lines: hunk, sourceEnd: hit.sourceEnd, sourceStart: hit.sourceStart }
      }
      cursor = hit.sourceEnd
    }
    this.rejectUnresolvable(placements, segments, source, indexes)
    this.fillGaps(placements, segments, source, indexes)
    this.stretch(placements, segments, source, indexes)
    this.extendBoundary(placements, segments, source, indexes)
    this.rejectSpans(placements, indexes)
    return placements as Types.HunkPlacement[]
  }

  /**
   * Find neighbor edge in placements.
   * @description Scans direction until a resolved placement appears.
   * @param placements - Resolved placements array by segment index
   * @param indexes - Indexes of hunk segments inside segments
   * @param step - Starting hunk step to scan from
   * @param direction - Scan direction over indexes
   * @returns Neighbor source edge or null when none found
   */
  static neighborEdge(
    placements: (Types.HunkPlacement | null)[],
    indexes: number[],
    step: number,
    direction: Types.ScanDirection
  ): number | null {
    for (let scan = step + direction; scan >= 0 && scan < indexes.length; scan += direction) {
      const placement = placements[indexes[scan]!]
      if (placement) {
        return direction === -1 ? placement.spot.sourceEnd : placement.spot.sourceStart
      }
    }
    return null
  }

  /**
   * Reject reordered or overlapping hunk spans.
   * @description Guards apply against unsound placement orderings.
   * @param placements - Resolved placements array by segment index
   * @param indexes - Indexes of hunk segments inside segments
   * @throws SyntaxError When hunks reorder or overlap in source
   */
  static rejectSpans(
    placements: (Types.HunkPlacement | null)[],
    indexes: number[]
  ): void {
    for (let index = 1; index < indexes.length; index += 1) {
      const prior = placements[indexes[index - 1]!]!.spot
      const current = placements[indexes[index]!]!.spot
      if (current.sourceStart < prior.sourceStart) {
        throw new SyntaxError(
          `apply hunk ${index} at ${current.sourceStart} to ${current.sourceEnd} lands before hunk ${
            index - 1
          } at ${prior.sourceStart} to ${prior.sourceEnd}`
        )
      }
      if (
        current.sourceStart < prior.sourceEnd &&
        prior.sourceEnd > prior.sourceStart &&
        current.sourceEnd > current.sourceStart
      ) {
        throw new SyntaxError(
          `apply hunks ${
            index - 1
          } and ${index} overlap on source span ${prior.sourceStart} to ${prior.sourceEnd} vs ${current.sourceStart} to ${current.sourceEnd}`
        )
      }
    }
  }

  /**
   * Reject hunks without anchor or neighbor.
   * @description Fails fast when hunk cannot be placed.
   * @param placements - Resolved placements array by segment index
   * @param segments - Parsed edit segments
   * @param source - Source lines used for anchor context
   * @param indexes - Indexes of hunk segments inside segments
   * @throws SyntaxError When a hunk cannot be anchored anywhere
   */
  static rejectUnresolvable(
    placements: (Types.HunkPlacement | null)[],
    segments: Types.EditSegment[],
    source: string[],
    indexes: number[]
  ): void {
    if (source.length === 0) {
      return
    }
    for (let step = 0; step < indexes.length; step += 1) {
      const index = indexes[step]!
      if (placements[index]) {
        continue
      }
      const before = index > 0 && segments[index - 1]!.kind === 'keep'
      const after = index + 1 < segments.length && segments[index + 1]!.kind === 'keep'
      const tail = this.neighborEdge(placements, indexes, step, -1)
      const next = this.neighborEdge(placements, indexes, step, 1)
      if (!before && !after && tail === null && next === null) {
        const preview = segments[index]!.lines.slice(0, 3).join('\n')
        throw new SyntaxError(
          `apply hunk ${step} has zero anchor and zero neighbor keeps. Preview\n${preview}`
        )
      }
    }
  }

  /**
   * Arm idle timer with duration.
   * @description Returns a no-op timer when duration is infinite.
   * @param duration - Idle timeout in milliseconds
   * @param expired - Callback invoked when timer expires
   * @returns Idle timer with clear and reset controls
   */
  static scheduleIdle(duration: number, expired: () => void): Types.IdleTimer {
    if (!Number.isFinite(duration)) {
      return { clear: () => {}, reset: () => {} }
    }
    let handle: ReturnType<typeof setTimeout> | null = null
    const reset = (): void => {
      if (handle !== null) {
        clearTimeout(handle)
      }
      handle = setTimeout(expired, duration)
      const unref = (handle as unknown as { unref?: () => void }).unref
      if (typeof unref === 'function') {
        unref.call(handle)
      }
    }
    reset()
    return {
      clear: () => {
        if (handle !== null) {
          clearTimeout(handle)
          handle = null
        }
      },
      reset
    }
  }

  /**
   * Stretch full placements into adjacent keeps.
   * @description Widens spans via backward and forward growth.
   * @param placements - Resolved placements array by segment index
   * @param segments - Parsed edit segments
   * @param source - Source lines being patched
   * @param indexes - Indexes of hunk segments inside segments
   */
  static stretch(
    placements: (Types.HunkPlacement | null)[],
    segments: Types.EditSegment[],
    source: string[],
    indexes: number[]
  ): void {
    const length = source.length
    for (let step = 0; step < indexes.length; step += 1) {
      const index = indexes[step]!
      const placement = placements[index]!
      if (placement.quality !== 'full' || placement.spot.sourceEnd <= placement.spot.sourceStart) {
        continue
      }
      const hunk = segments[index]!.lines
      if (index > 0 && segments[index - 1]!.kind === 'keep' && placement.hunkHead > 0) {
        const floor = this.neighborEdge(placements, indexes, step, -1) ?? 0
        this.growBackward(placement.spot, source, hunk, placement.hunkHead - 1, floor)
      }
      if (
        index + 1 < segments.length &&
        segments[index + 1]!.kind === 'keep' &&
        placement.hunkTail < hunk.length - 1
      ) {
        const ceiling = this.neighborEdge(placements, indexes, step, 1) ?? length
        this.growForward(placement.spot, source, hunk, placement.hunkTail + 1, ceiling)
      }
    }
  }
}
