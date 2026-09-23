import type * as Types from '@app/types.ts'
import Unicode from '@app/unicode.ts'

/**
 * Locate hunks via fuzzy matching.
 * @description Combines anchor chaining with edit-distance fallback.
 */
export default class Matcher {
  /** Minimum similarity accepted by fuzzy match */
  private static readonly fuzzyThreshold = 0.85
  /** Minimum similarity accepted by kin check */
  private static readonly kinThreshold = 0.75
  /** Minimum coverage ratio for short chains */
  private static readonly minCoverage = 0.5

  /**
   * Anchor a hunk to source.
   * @description Builds pairs and picks longest ordered chain.
   * @param hunk - Hunk lines to place inside source
   * @param anchor - Canonicalized hunk lines for anchor mode
   * @param catalog - Canonical line index built from the source
   * @param cursor - Lower search bound in source
   * @param ceiling - Upper search bound in source
   * @returns Anchor hit describing the match or null
   */
  static anchor(
    hunk: string[],
    anchor: string[],
    catalog: Map<string, number[]>,
    cursor: number,
    ceiling: number
  ): Types.AnchorHit | null {
    if (hunk.length === 0 || cursor >= ceiling) {
      return null
    }
    const pairs: Types.AnchorPair[] = []
    for (let mark = 0; mark < hunk.length; mark += 1) {
      if (this.isBlank(hunk[mark]!)) {
        continue
      }
      const hits = catalog.get(anchor[mark]!)
      if (!hits) {
        continue
      }
      for (const offset of hits) {
        if (offset >= cursor && offset < ceiling) {
          pairs.push({ hunkIndex: mark, sourceIndex: offset })
        }
      }
    }
    if (pairs.length === 0) {
      return null
    }
    const size = pairs.length
    const lengths = new Int32Array(size).fill(1)
    const previous = new Int32Array(size).fill(-1)
    let span = 0
    for (const pair of pairs) {
      if (pair.sourceIndex > span) {
        span = pair.sourceIndex
      }
    }
    const dense = size * 4 > span
    const ranks = dense
      ? null
      : [...new Set(pairs.map((pair) => pair.sourceIndex))].sort((origin, goal) => origin - goal)
    const rank = dense ? null : new Map(ranks!.map((offset, slot) => [offset, slot]))
    let leaf = 1
    const limit = dense ? span + 1 : ranks!.length
    while (leaf < limit) {
      leaf <<= 1
    }
    const winner = new Int32Array(leaf << 1).fill(-1)
    const prefer = (origin: number, goal: number): boolean =>
      origin >= 0 &&
      (goal < 0 || lengths[origin]! > lengths[goal]! ||
        (lengths[origin] === lengths[goal] && origin < goal))
    let longest = 1
    let group = 0
    let hop = 0
    while (group < size) {
      let stop = group + 1
      while (stop < size && pairs[stop]!.hunkIndex === pairs[group]!.hunkIndex) {
        stop += 1
      }
      for (let index = group; index < stop; index += 1) {
        let bound = pairs[index]!.sourceIndex
        if (!dense) {
          while (hop < ranks!.length && ranks![hop]! < bound) {
            hop += 1
          }
          bound = hop
        }
        let origin = leaf
        let goal = leaf + bound
        let best = -1
        while (origin < goal) {
          if ((origin & 1) === 1) {
            if (prefer(winner[origin]!, best)) {
              best = winner[origin]!
            }
            origin += 1
          }
          if ((goal & 1) === 1) {
            goal -= 1
            if (prefer(winner[goal]!, best)) {
              best = winner[goal]!
            }
          }
          origin >>= 1
          goal >>= 1
        }
        const prior = best
        if (prior !== -1) {
          lengths[index] = lengths[prior]! + 1
          previous[index] = prior
        }
        if (lengths[index]! > longest) {
          longest = lengths[index]!
        }
      }
      for (let index = group; index < stop; index += 1) {
        const slot = leaf +
          (dense ? pairs[index]!.sourceIndex : rank!.get(pairs[index]!.sourceIndex)!)
        if (prefer(index, winner[slot]!)) {
          winner[slot] = index
        }
      }
      for (let slot = leaf - 1; slot > 0; slot -= 1) {
        const origin = winner[slot << 1]!
        const goal = winner[(slot << 1) + 1]!
        winner[slot] = prefer(origin, goal) ? origin : goal
      }
      group = stop
    }
    let chosen = -1
    let tightest = Number.POSITIVE_INFINITY
    let earliest = Number.POSITIVE_INFINITY
    for (let index = 0; index < size; index += 1) {
      if (lengths[index] !== longest) {
        continue
      }
      let link = index
      let head = index
      while (previous[link] !== -1) {
        link = previous[link]!
        head = link
      }
      const tightness = pairs[index]!.sourceIndex - pairs[head]!.sourceIndex + 1
      const origin = pairs[head]!.sourceIndex
      if (tightness < tightest || (tightness === tightest && origin < earliest)) {
        tightest = tightness
        earliest = origin
        chosen = index
      }
    }
    if (chosen === -1) {
      return null
    }
    const live = this.countLive(hunk)
    if (longest < 2 && (live === 0 ? 0 : longest / live) < this.minCoverage) {
      return null
    }
    let link = chosen
    let origin = chosen
    while (previous[link] !== -1) {
      link = previous[link]!
      origin = link
    }
    const head = pairs[origin]!
    const tail = pairs[chosen]!
    return {
      chainLength: longest,
      hunkHead: head.hunkIndex,
      hunkTail: tail.hunkIndex,
      sourceEnd: tail.sourceIndex + 1,
      sourceStart: head.sourceIndex
    }
  }

  /**
   * Index anchor lines once per apply.
   * @description Maps each canonical line to its source positions.
   * @param anchor - Canonicalized source lines for anchor mode
   * @returns Map from canonical line to ascending source indexes
   */
  static anchorIndex(anchor: string[]): Map<string, number[]> {
    const index = new Map<string, number[]>()
    for (let cursor = 0; cursor < anchor.length; cursor += 1) {
      const needle = anchor[cursor]!
      if (needle.length === 0) {
        continue
      }
      const hits = index.get(needle)
      if (hits) {
        hits.push(cursor)
      } else {
        index.set(needle, [cursor])
      }
    }
    return index
  }

  /**
   * Canonicalize a line for matching.
   * @description Folds Unicode then collapses whitespace by mode.
   * @param line - Raw source or hunk line to canonicalize
   * @param mode - Canonicalization mode to apply
   * @returns Canonicalized line string
   */
  static canonical(line: string, mode: Types.CanonMode): string {
    if (mode === 'anchor') {
      let folded = ''
      let start = 0
      let ascii = true
      for (let index = 0; index < line.length; index += 1) {
        const code = line.charCodeAt(index)
        if (code >= 0x80) {
          ascii = false
          break
        }
        if (code <= 0x20 || code === 0x22 || code === 0x27) {
          folded = `${folded}${line.slice(start, index)}`
          if (code === 0x22 || code === 0x27) {
            folded = `${folded}"`
          }
          start = index + 1
        }
      }
      if (ascii) {
        return start === 0 ? line : `${folded}${line.slice(start)}`
      }
    } else {
      let first = 0
      while (first < line.length && line.charCodeAt(first) <= 0x20) {
        first += 1
      }
      let last = line.length
      while (last > first && line.charCodeAt(last - 1) <= 0x20) {
        last -= 1
      }
      let folded = ''
      let start = first
      let gap = false
      let ascii = true
      for (let index = first; index < last; index += 1) {
        const code = line.charCodeAt(index)
        if (code >= 0x80) {
          ascii = false
          break
        }
        if (code === 0x22 || code === 0x27) {
          folded = `${folded}${line.slice(start, index)}"`
          start = index + 1
          gap = false
        } else if (code === 0x09 || code === 0x20) {
          if (!gap) {
            folded = `${folded}${line.slice(start, index)} `
          }
          start = index + 1
          gap = true
        } else {
          gap = false
        }
      }
      if (ascii) {
        return start === first && folded === ''
          ? line.slice(first, last)
          : `${folded}${line.slice(start, last)}`
      }
    }
    const folded = Unicode.normalize(line).replace(/["']/g, '"')
    return mode === 'anchor' ? folded.replace(/\s+/g, '') : folded.replace(/[ \t]+/g, ' ').trim()
  }

  /**
   * Count lines that are not blank.
   * @description Uses trim length as the blank predicate.
   * @param lines - Lines to inspect for content
   * @returns Number of non-blank lines
   */
  static countLive(lines: string[]): number {
    let count = 0
    for (const line of lines) {
      if (!this.isBlank(line)) {
        count += 1
      }
    }
    return count
  }

  /**
   * Fuzzy-match a hunk against source window.
   * @description Scans windows and picks the highest similarity.
   * @param hunk - Original hunk lines used for size only
   * @param canon - Canonicalized hunk lines in soft mode
   * @param source - Canonicalized source lines in soft mode
   * @param cursor - Lower search bound in source
   * @param ceiling - Upper search bound in source
   * @returns Anchor hit at the best window or null
   */
  static fuzzy(
    hunk: string[],
    canon: string[],
    source: string[],
    cursor: number,
    ceiling: number
  ): Types.AnchorHit | null {
    const size = hunk.length
    if (size === 0 || ceiling - cursor < size) {
      return null
    }
    const joined = canon.join('\n')
    let start = -1
    let score = -1
    const last = ceiling - size
    for (let offset = cursor; offset <= last; offset += 1) {
      const window = source.slice(offset, offset + size).join('\n')
      const span = Math.max(window.length, joined.length)
      if (span === 0) {
        if (score < 1) {
          score = 1
          start = offset
        }
        continue
      }
      const limit = Math.floor((1 - Math.max(score, this.fuzzyThreshold)) * span)
      const edits = ((): number => {
        if (Math.abs(window.length - joined.length) > limit) {
          return limit + 1
        }
        if (window === joined) {
          return 0
        }
        const width = joined.length + 1
        let prior = new Int32Array(width)
        let active = new Int32Array(width)
        for (let column = 0; column < width; column += 1) {
          prior[column] = column
        }
        for (let row = 1; row <= window.length; row += 1) {
          active[0] = row
          const code = window.charCodeAt(row - 1)
          const from = Math.max(1, row - limit)
          const to = Math.min(joined.length, row + limit)
          let best = row
          for (let column = 1; column < from; column += 1) {
            active[column] = limit + 1
          }
          for (let column = from; column <= to; column += 1) {
            const cost = code === joined.charCodeAt(column - 1) ? 0 : 1
            const cell = Math.min(
              active[column - 1]! + 1,
              prior[column]! + 1,
              prior[column - 1]! + cost
            )
            active[column] = cell
            if (cell < best) {
              best = cell
            }
          }
          for (let column = to + 1; column < width; column += 1) {
            active[column] = limit + 1
          }
          if (best > limit) {
            return limit + 1
          }
          const swap = prior
          prior = active
          active = swap
        }
        return prior[joined.length]!
      })()
      if (edits > limit) {
        continue
      }
      const similarity = 1 - edits / span
      if (similarity > score) {
        score = similarity
        start = offset
      }
    }
    if (start === -1 || score < this.fuzzyThreshold) {
      return null
    }
    return {
      chainLength: size,
      hunkHead: 0,
      hunkTail: size - 1,
      sourceEnd: start + size,
      sourceStart: start
    }
  }

  /**
   * Test whether a line is blank.
   * @description Blank means empty after trimming whitespace.
   * @param line - Line to inspect
   * @returns True when line is blank
   */
  static isBlank(line: string): boolean {
    return line.trim().length === 0
  }

  /**
   * Decide whether two lines are kin.
   * @description Compares soft canonical forms via similarity.
   * @param source - Line from the source text
   * @param hunk - Line from the hunk being placed
   * @returns True when similarity clears the kin threshold
   */
  static kin(source: string, hunk: string): boolean {
    if (this.isBlank(source) || this.isBlank(hunk)) {
      return false
    }
    return this.similarity(
      this.canonical(source, 'soft'),
      this.canonical(hunk, 'soft')
    ) >= this.kinThreshold
  }

  /**
   * Reject windows below fuzzy threshold.
   * @description Compares non-space lengths against the similarity bound.
   * @param source - Source lines whose fuzzy range is being tested
   * @param hunk - Soft canonical hunk lines
   * @param cursor - Lower search bound in source
   * @param ceiling - Upper search bound in source
   * @returns True when every window misses the similarity threshold
   */
  static lengthReject(
    source: string[],
    hunk: string[],
    cursor: number,
    ceiling: number
  ): boolean {
    const size = hunk.length
    if (size === 0 || ceiling - cursor < size) {
      return true
    }
    let goal = Math.max(0, size - 1)
    for (const line of hunk) {
      goal += line.length
    }
    const prefix = new Int32Array(ceiling - cursor + 1)
    for (let index = cursor; index < ceiling; index += 1) {
      prefix[index - cursor + 1] = prefix[index - cursor]! + source[index]!.length
    }
    const windows = ceiling - cursor - size + 1
    for (let offset = 0; offset < windows; offset += 1) {
      const window = prefix[offset + size]! - prefix[offset]! + Math.max(0, size - 1)
      const limit = Math.floor((1 - this.fuzzyThreshold) * Math.max(window, goal))
      if (Math.abs(window - goal) <= limit) {
        return false
      }
    }
    return true
  }

  /**
   * Similarity ratio between two strings.
   * @description One minus normalized Levenshtein distance.
   * @param left - Left string operand
   * @param right - Right string operand
   * @returns Similarity ratio in the zero to one range
   */
  static similarity(left: string, right: string): number {
    const span = Math.max(left.length, right.length)
    if (span === 0) {
      return 1
    }
    let edits: number
    if (left === right) {
      edits = 0
    } else if (left.length === 0) {
      edits = right.length
    } else if (right.length === 0) {
      edits = left.length
    } else {
      const width = right.length + 1
      let prior = new Int32Array(width)
      let active = new Int32Array(width)
      for (let offset = 0; offset < width; offset += 1) {
        prior[offset] = offset
      }
      for (let cursor = 1; cursor <= left.length; cursor += 1) {
        active[0] = cursor
        const code = left.charCodeAt(cursor - 1)
        for (let offset = 1; offset < width; offset += 1) {
          const cost = code === right.charCodeAt(offset - 1) ? 0 : 1
          active[offset] = Math.min(
            active[offset - 1]! + 1,
            prior[offset]! + 1,
            prior[offset - 1]! + cost
          )
        }
        const swap = prior
        prior = active
        active = swap
      }
      edits = prior[right.length]!
    }
    return 1 - edits / span
  }
}
