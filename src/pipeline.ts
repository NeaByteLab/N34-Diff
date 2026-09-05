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
   * @param hunkAt - Indexes of hunk segments inside segments
   * @returns Merged output plus per-hunk end positions
   */
  static assemble(
    segments: Types.EditSegment[],
    source: string[],
    placements: Types.HunkPlacement[],
    hunkAt: number[]
  ): Types.AssembleResult {
    const output: string[] = []
    const hunkEnd: number[] = new Array(hunkAt.length)
    const length = source.length
    let cursor = 0
    let hunkStep = 0
    for (const segment of segments) {
      if (segment.kind === 'keep') {
        const laterStart = hunkStep < hunkAt.length
          ? placements[hunkAt[hunkStep]!]!.spot.sourceStart
          : length
        if (cursor < laterStart) {
          for (let at = cursor; at < laterStart; at += 1) {
            output.push(source[at]!)
          }
          cursor = laterStart
        } else if (hunkStep > 0 && hunkStep < hunkAt.length) {
          for (const indent of segment.lines) {
            if (indent.length > 0) {
              output.push(indent)
            }
          }
        }
        continue
      }
      const spot = placements[hunkAt[hunkStep]!]!.spot
      for (let at = cursor; at < spot.sourceStart; at += 1) {
        output.push(source[at]!)
      }
      const span = spot.sourceEnd - spot.sourceStart
      for (let row = 0; row < spot.lines.length; row += 1) {
        const target = span === 0 ? '' : source[spot.sourceStart + Math.min(row, span - 1)]!
        output.push(Quote.restyle(spot.lines[row]!, target))
      }
      cursor = Math.max(cursor, spot.sourceEnd)
      hunkEnd[hunkStep] = output.length
      hunkStep += 1
    }
    return { output, hunkEnd }
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
    const hunkAt: number[] = []
    for (let index = 0; index < segments.length; index += 1) {
      if (segments[index]!.kind === 'hunk') {
        hunkAt.push(index)
      }
    }
    return hunkAt
  }

  /**
   * Extend boundary hunks to source edges.
   * @description Snaps first and last hunk spans when keeps missing.
   * @param placements - Resolved placements array by segment index
   * @param segments - Parsed edit segments
   * @param source - Source lines used for edge alignment
   * @param hunkAt - Indexes of hunk segments inside segments
   */
  static extendBoundary(
    placements: (Types.HunkPlacement | null)[],
    segments: Types.EditSegment[],
    source: string[],
    hunkAt: number[]
  ): void {
    const first = hunkAt[0]!
    const last = hunkAt[hunkAt.length - 1]!
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
   * @param hunkAt - Indexes of hunk segments inside segments
   * @throws RangeError When neighbor edges yield a negative span
   */
  static fillGaps(
    placements: (Types.HunkPlacement | null)[],
    segments: Types.EditSegment[],
    source: string[],
    hunkAt: number[]
  ): void {
    const length = source.length
    for (let step = 0; step < hunkAt.length; step += 1) {
      const index = hunkAt[step]!
      if (placements[index]) {
        continue
      }
      const priorKeep = index > 0 && segments[index - 1]!.kind === 'keep'
      const laterKeep = index + 1 < segments.length && segments[index + 1]!.kind === 'keep'
      const priorEnd = this.neighborEdge(placements, hunkAt, step, -1)
      const laterStart = this.neighborEdge(placements, hunkAt, step, 1)
      let start: number
      let end: number
      if (priorEnd === null && laterStart === null && priorKeep && laterKeep) {
        start = 0
        end = length
      } else {
        start = priorEnd ?? (priorKeep ? length : 0)
        end = laterStart ?? (laterKeep ? 0 : length)
        if (end < start) {
          throw new RangeError(
            `apply hunk ${step} derived a negative span [${start}, ${end}) from reordered neighbors`
          )
        }
      }
      if (priorKeep && start < end && Matcher.isBlank(source[start] ?? '')) {
        start += 1
      }
      if (laterKeep && end > start && Matcher.isBlank(source[end - 1] ?? '')) {
        end -= 1
      }
      if (end < start) {
        end = start
      }
      placements[index] = {
        spot: { sourceStart: start, sourceEnd: end, lines: segments[index]!.lines },
        quality: 'gapfill',
        hunkHead: 0,
        hunkTail: segments[index]!.lines.length - 1
      }
    }
  }

  /**
   * Grow hunk span backward.
   * @description Absorbs kin lines and skips blank hops until floor.
   * @param spot - Hunk spot being widened backward
   * @param source - Source lines to compare against
   * @param hunk - Hunk lines used for kin comparison
   * @param hunkProbe - Starting hunk index moving backward
   * @param floor - Lower bound the source cursor may reach
   */
  static growBackward(
    spot: Types.HunkSpot,
    source: string[],
    hunk: string[],
    hunkProbe: number,
    floor: number
  ): void {
    let hunkCursor = hunkProbe
    while (hunkCursor >= 0 && spot.sourceStart > floor) {
      const probeIndex = spot.sourceStart - 1
      const probe = source[probeIndex]!
      const hunkLine = hunk[hunkCursor]!
      if (Matcher.kin(probe, hunkLine)) {
        spot.sourceStart -= 1
        hunkCursor -= 1
        continue
      }
      const hopIndex = probeIndex - 1
      if (Matcher.isBlank(probe) && hopIndex >= floor && Matcher.kin(source[hopIndex]!, hunkLine)) {
        spot.sourceStart -= 2
        hunkCursor -= 1
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
   * @param hunkProbe - Starting hunk index moving forward
   * @param ceiling - Upper bound the source cursor may reach
   */
  static growForward(
    spot: Types.HunkSpot,
    source: string[],
    hunk: string[],
    hunkProbe: number,
    ceiling: number
  ): void {
    let hunkCursor = hunkProbe
    while (hunkCursor < hunk.length && spot.sourceEnd < ceiling) {
      const probeIndex = spot.sourceEnd
      const probe = source[probeIndex]!
      const hunkLine = hunk[hunkCursor]!
      if (Matcher.kin(probe, hunkLine)) {
        spot.sourceEnd += 1
        hunkCursor += 1
        continue
      }
      const hopIndex = probeIndex + 1
      if (
        Matcher.isBlank(probe) &&
        hopIndex < ceiling &&
        Matcher.kin(source[hopIndex]!, hunkLine)
      ) {
        spot.sourceEnd += 2
        hunkCursor += 1
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
   * @param hunkAt - Indexes of hunk segments inside segments
   * @param deadline - Deadline window or null to skip check
   * @returns Placements array aligned with segments length
   * @throws SyntaxError When a hunk cannot be anchored or overlaps
   * @throws RangeError When the deadline budget elapses
   */
  static locate(
    segments: Types.EditSegment[],
    source: string[],
    hunkAt: number[],
    deadline: Types.DeadlineWindow | null
  ): Types.HunkPlacement[] {
    const length = source.length
    const sourceAnchor = source.map((line) => Matcher.canonical(line, 'anchor'))
    let canonCache: string[] | null = null
    const resolveCanon = (): string[] => {
      if (canonCache === null) {
        canonCache = source.map((line) => Matcher.canonical(line, 'soft'))
      }
      return canonCache
    }
    const placements: (Types.HunkPlacement | null)[] = new Array(segments.length).fill(null)
    if (segments.length === 1 && hunkAt.length === 1) {
      const hunk = segments[hunkAt[0]!]!.lines
      placements[hunkAt[0]!] = {
        spot: { sourceStart: 0, sourceEnd: length, lines: hunk },
        quality: 'full',
        hunkHead: 0,
        hunkTail: hunk.length - 1
      }
      return placements as Types.HunkPlacement[]
    }
    let cursor = 0
    for (let step = 0; step < hunkAt.length; step += 1) {
      this.checkDeadline(deadline)
      const index = hunkAt[step]!
      const hunk = segments[index]!.lines
      const hunkAnchor = hunk.map((line) => Matcher.canonical(line, 'anchor'))
      const hit = Matcher.anchor(hunk, hunkAnchor, sourceAnchor, cursor, length) ??
        Matcher.fuzzy(
          hunk,
          hunk.map((line) => Matcher.canonical(line, 'soft')),
          resolveCanon(),
          cursor,
          length
        )
      if (!hit) {
        continue
      }
      const nonBlank = Matcher.countLive(hunk)
      placements[index] = {
        spot: { sourceStart: hit.sourceStart, sourceEnd: hit.sourceEnd, lines: hunk },
        quality: nonBlank > 0 && hit.chainLength >= nonBlank ? 'full' : 'partial',
        hunkHead: hit.hunkHead,
        hunkTail: hit.hunkTail
      }
      cursor = hit.sourceEnd
    }
    this.rejectUnresolvable(placements, segments, source, hunkAt)
    this.fillGaps(placements, segments, source, hunkAt)
    this.stretch(placements, segments, source, hunkAt)
    this.extendBoundary(placements, segments, source, hunkAt)
    this.rejectSpans(placements, hunkAt)
    return placements as Types.HunkPlacement[]
  }

  /**
   * Find neighbor edge in placements.
   * @description Scans direction until a resolved placement appears.
   * @param placements - Resolved placements array by segment index
   * @param hunkAt - Indexes of hunk segments inside segments
   * @param step - Starting hunk step to scan from
   * @param direction - Scan direction over hunkAt
   * @returns Neighbor source edge or null when none found
   */
  static neighborEdge(
    placements: (Types.HunkPlacement | null)[],
    hunkAt: number[],
    step: number,
    direction: Types.ScanDirection
  ): number | null {
    for (let scan = step + direction; scan >= 0 && scan < hunkAt.length; scan += direction) {
      const placement = placements[hunkAt[scan]!]
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
   * @param hunkAt - Indexes of hunk segments inside segments
   * @throws SyntaxError When hunks reorder or overlap in source
   */
  static rejectSpans(
    placements: (Types.HunkPlacement | null)[],
    hunkAt: number[]
  ): void {
    for (let index = 1; index < hunkAt.length; index += 1) {
      const prior = placements[hunkAt[index - 1]!]!.spot
      const current = placements[hunkAt[index]!]!.spot
      if (current.sourceStart < prior.sourceStart) {
        throw new SyntaxError(
          `apply hunk ${index} at [${current.sourceStart}, ${current.sourceEnd}) lands before hunk ${
            index - 1
          } at [${prior.sourceStart}, ${prior.sourceEnd})`
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
          } and ${index} overlap on source span [${prior.sourceStart}, ${prior.sourceEnd}) vs [${current.sourceStart}, ${current.sourceEnd})`
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
   * @param hunkAt - Indexes of hunk segments inside segments
   * @throws SyntaxError When a hunk cannot be anchored anywhere
   */
  static rejectUnresolvable(
    placements: (Types.HunkPlacement | null)[],
    segments: Types.EditSegment[],
    source: string[],
    hunkAt: number[]
  ): void {
    if (source.length === 0) {
      return
    }
    for (let step = 0; step < hunkAt.length; step += 1) {
      const index = hunkAt[step]!
      if (placements[index]) {
        continue
      }
      const priorKeep = index > 0 && segments[index - 1]!.kind === 'keep'
      const laterKeep = index + 1 < segments.length && segments[index + 1]!.kind === 'keep'
      const priorEnd = this.neighborEdge(placements, hunkAt, step, -1)
      const laterStart = this.neighborEdge(placements, hunkAt, step, 1)
      if (!priorKeep && !laterKeep && priorEnd === null && laterStart === null) {
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
    const arm = (): void => {
      if (handle !== null) {
        clearTimeout(handle)
      }
      handle = setTimeout(expired, duration)
      const unref = (handle as unknown as { unref?: () => void }).unref
      if (typeof unref === 'function') {
        unref.call(handle)
      }
    }
    arm()
    return {
      clear: () => {
        if (handle !== null) {
          clearTimeout(handle)
          handle = null
        }
      },
      reset: arm
    }
  }

  /**
   * Stretch full placements into adjacent keeps.
   * @description Widens spans via backward and forward growth.
   * @param placements - Resolved placements array by segment index
   * @param segments - Parsed edit segments
   * @param source - Source lines being patched
   * @param hunkAt - Indexes of hunk segments inside segments
   */
  static stretch(
    placements: (Types.HunkPlacement | null)[],
    segments: Types.EditSegment[],
    source: string[],
    hunkAt: number[]
  ): void {
    const length = source.length
    for (let step = 0; step < hunkAt.length; step += 1) {
      const index = hunkAt[step]!
      const placement = placements[index]!
      if (placement.quality !== 'full' || placement.spot.sourceEnd <= placement.spot.sourceStart) {
        continue
      }
      const hunk = segments[index]!.lines
      if (index > 0 && segments[index - 1]!.kind === 'keep' && placement.hunkHead > 0) {
        const floor = this.neighborEdge(placements, hunkAt, step, -1) ?? 0
        this.growBackward(placement.spot, source, hunk, placement.hunkHead - 1, floor)
      }
      if (
        index + 1 < segments.length &&
        segments[index + 1]!.kind === 'keep' &&
        placement.hunkTail < hunk.length - 1
      ) {
        const ceiling = this.neighborEdge(placements, hunkAt, step, 1) ?? length
        this.growForward(placement.spot, source, hunk, placement.hunkTail + 1, ceiling)
      }
    }
  }
}
