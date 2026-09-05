import type * as Types from '@app/types.ts'
import Unicode from '@app/unicode.ts'

/**
 * Locate hunks via fuzzy matching.
 * @description Combines anchor chaining with edit-distance fallback.
 */
export default class Matcher {
  /** Cap on enumerated chain paths */
  private static readonly chainLimit = 4096
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
   * @param hunkAnchor - Canonicalized hunk lines for anchor mode
   * @param sourceAnchor - Canonicalized source lines for anchor mode
   * @param cursor - Lower search bound in source
   * @param ceiling - Upper search bound in source
   * @returns Anchor hit describing the match or null
   */
  static anchor(
    hunk: string[],
    hunkAnchor: string[],
    sourceAnchor: string[],
    cursor: number,
    ceiling: number
  ): Types.AnchorHit | null {
    if (hunk.length === 0 || cursor >= ceiling) {
      return null
    }
    const pairs = this.buildPair(hunk, hunkAnchor, sourceAnchor, cursor, ceiling)
    if (pairs.length === 0) {
      return null
    }
    return this.chooseChain(pairs, hunk)
  }

  /**
   * Canonicalize a line for matching.
   * @description Folds Unicode then collapses whitespace by mode.
   * @param line - Raw source or hunk line to canonicalize
   * @param mode - Canonicalization mode to apply
   * @returns Canonicalized line string
   */
  static canonical(line: string, mode: Types.CanonMode): string {
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
   * @param hunkCanon - Canonicalized hunk lines in soft mode
   * @param sourceCanon - Canonicalized source lines in soft mode
   * @param cursor - Lower search bound in source
   * @param ceiling - Upper search bound in source
   * @returns Anchor hit at the best window or null
   */
  static fuzzy(
    hunk: string[],
    hunkCanon: string[],
    sourceCanon: string[],
    cursor: number,
    ceiling: number
  ): Types.AnchorHit | null {
    const size = hunk.length
    if (size === 0 || ceiling - cursor < size) {
      return null
    }
    const joined = hunkCanon.join('\n')
    let start = -1
    let score = -1
    for (let offset = cursor; offset <= ceiling - size; offset += 1) {
      const similarity = this.similarity(
        sourceCanon.slice(offset, offset + size).join('\n'),
        joined
      )
      if (similarity > score) {
        score = similarity
        start = offset
      }
    }
    if (start === -1 || score < this.fuzzyThreshold) {
      return null
    }
    return {
      sourceStart: start,
      sourceEnd: start + size,
      chainLength: size,
      hunkHead: 0,
      hunkTail: size - 1
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
   * @param sourceLine - Line from the source text
   * @param hunkLine - Line from the hunk being placed
   * @returns True when similarity clears the kin threshold
   */
  static kin(sourceLine: string, hunkLine: string): boolean {
    if (this.isBlank(sourceLine) || this.isBlank(hunkLine)) {
      return false
    }
    return this.similarity(
      this.canonical(sourceLine, 'soft'),
      this.canonical(hunkLine, 'soft')
    ) >= this.kinThreshold
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
    return 1 - this.distance(left, right) / span
  }

  /**
   * Collect anchor pairs for hunk.
   * @description Emits equal-anchor pairs sorted by hunk index.
   * @param hunk - Raw hunk lines used for blank filtering
   * @param hunkAnchor - Canonicalized hunk lines in anchor mode
   * @param sourceAnchor - Canonicalized source lines in anchor mode
   * @param cursor - Lower search bound in source
   * @param ceiling - Upper search bound in source
   * @returns Sorted array of anchor pairs
   */
  private static buildPair(
    hunk: string[],
    hunkAnchor: string[],
    sourceAnchor: string[],
    cursor: number,
    ceiling: number
  ): Types.AnchorPair[] {
    const pairs: Types.AnchorPair[] = []
    for (let row = 0; row < hunk.length; row += 1) {
      if (this.isBlank(hunk[row]!)) {
        continue
      }
      const needle = hunkAnchor[row]!
      if (needle.length === 0) {
        continue
      }
      for (let col = cursor; col < ceiling; col += 1) {
        if (sourceAnchor[col] === needle) {
          pairs.push({ hunkIndex: row, sourceIndex: col })
        }
      }
    }
    pairs.sort((left, right) =>
      left.hunkIndex - right.hunkIndex || left.sourceIndex - right.sourceIndex
    )
    return pairs
  }

  /**
   * Choose best chain from pairs.
   * @description Picks the tightest longest chain over pair graph.
   * @param pairs - Sorted anchor pairs to search over
   * @param hunk - Hunk lines used for coverage check
   * @returns Anchor hit describing the chosen chain or null
   */
  private static chooseChain(pairs: Types.AnchorPair[], hunk: string[]): Types.AnchorHit | null {
    const size = pairs.length
    const lengths = new Int32Array(size).fill(1)
    const parents: number[][] = Array.from({ length: size }, () => [])
    let longest = 1
    for (let index = 0; index < size; index += 1) {
      const pair = pairs[index]!
      for (let prior = 0; prior < index; prior += 1) {
        const earlier = pairs[prior]!
        if (earlier.hunkIndex >= pair.hunkIndex || earlier.sourceIndex >= pair.sourceIndex) {
          continue
        }
        const candidate = lengths[prior]! + 1
        if (candidate > lengths[index]!) {
          lengths[index] = candidate
          parents[index] = [prior]
        } else if (candidate === lengths[index]!) {
          parents[index]!.push(prior)
        }
      }
      if (lengths[index]! > longest) {
        longest = lengths[index]!
      }
    }
    const chains = this.enumerateChain(lengths, parents, longest)
    if (chains.length === 0) {
      return null
    }
    let bestChain: number[] | null = null
    let bestTightness = Number.POSITIVE_INFINITY
    let bestIndices: number[] | null = null
    for (const chain of chains) {
      const head = pairs[chain[0]!]!
      const tail = pairs[chain[chain.length - 1]!]!
      const tightness = tail.sourceIndex - head.sourceIndex + 1
      if (tightness > bestTightness) {
        continue
      }
      const indices = chain.map((node) => pairs[node]!.sourceIndex)
      if (
        tightness < bestTightness ||
        bestIndices === null ||
        this.compareVectors(indices, bestIndices) < 0
      ) {
        bestTightness = tightness
        bestIndices = indices
        bestChain = chain
      }
    }
    if (!bestChain) {
      return null
    }
    const nonBlank = this.countLive(hunk)
    if (longest < 2 && (nonBlank === 0 ? 0 : longest / nonBlank) < this.minCoverage) {
      return null
    }
    const head = pairs[bestChain[0]!]!
    const tail = pairs[bestChain[bestChain.length - 1]!]!
    return {
      sourceStart: head.sourceIndex,
      sourceEnd: tail.sourceIndex + 1,
      chainLength: longest,
      hunkHead: head.hunkIndex,
      hunkTail: tail.hunkIndex
    }
  }

  /**
   * Lexicographically compare two number vectors.
   * @description Returns negative, zero, or positive per usual convention.
   * @param left - Left vector operand
   * @param right - Right vector operand
   * @returns Signed integer indicating relative order
   */
  private static compareVectors(left: number[], right: number[]): number {
    const size = Math.min(left.length, right.length)
    for (let index = 0; index < size; index += 1) {
      const diff = left[index]! - right[index]!
      if (diff !== 0) {
        return diff
      }
    }
    return left.length - right.length
  }

  /**
   * Levenshtein edit distance between two strings.
   * @description Rolling two-row dynamic programming implementation.
   * @param left - Left string operand
   * @param right - Right string operand
   * @returns Edit distance as a non-negative integer
   */
  private static distance(left: string, right: string): number {
    if (left === right) {
      return 0
    }
    if (left.length === 0) {
      return right.length
    }
    if (right.length === 0) {
      return left.length
    }
    const width = right.length + 1
    let prev = new Int32Array(width)
    let curr = new Int32Array(width)
    for (let col = 0; col < width; col += 1) {
      prev[col] = col
    }
    for (let row = 1; row <= left.length; row += 1) {
      curr[0] = row
      const code = left.charCodeAt(row - 1)
      for (let col = 1; col < width; col += 1) {
        const cost = code === right.charCodeAt(col - 1) ? 0 : 1
        curr[col] = Math.min(curr[col - 1]! + 1, prev[col]! + 1, prev[col - 1]! + cost)
      }
      const swap = prev
      prev = curr
      curr = swap
    }
    return prev[right.length]!
  }

  /**
   * Enumerate longest chains from parent links.
   * @description Walks parent pointers backward up to chain limit.
   * @param lengths - Chain length per pair index
   * @param parents - Parent index sets per pair
   * @param longest - Length target for enumerated chains
   * @returns Array of chains as ordered pair index arrays
   */
  private static enumerateChain(
    lengths: Int32Array,
    parents: number[][],
    longest: number
  ): number[][] {
    const size = lengths.length
    const chains: number[][] = []
    const stack: Types.ChainFrame[] = []
    for (let index = 0; index < size; index += 1) {
      if (lengths[index] === longest) {
        stack.push({ path: [index], node: index })
      }
    }
    while (stack.length > 0) {
      const { path, node } = stack.pop()!
      const parentNodes = parents[node]!
      if (parentNodes.length === 0) {
        const reversed = new Array<number>(path.length)
        for (let index = 0; index < path.length; index += 1) {
          reversed[index] = path[path.length - 1 - index]!
        }
        chains.push(reversed)
        if (chains.length >= this.chainLimit) {
          break
        }
        continue
      }
      for (const parent of parentNodes) {
        stack.push({ path: [...path, parent], node: parent })
      }
    }
    return chains
  }
}
