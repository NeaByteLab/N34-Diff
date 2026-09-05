import type * as Types from '@app/types.ts'
import Unicode from '@app/unicode.ts'

/**
 * Segment edit body into hunks.
 * @description Detects SKIP markers and splits lines into segments.
 */
export default class Parser {
  /** Regex matching leading whitespace */
  private static readonly indentPattern = /^[ \t]*/
  /** Regex matching a SKIP marker line */
  private static readonly markerPattern = /^([ \t]*)<<<<<<<[ \t]*SKIP[ \t]*$/i

  /**
   * Create a fresh incremental edit segmenter.
   * @description Returns a segmenter with feed and flush controls.
   * @returns Segmenter instance ready to accept lines
   */
  static createSegmenter(): Types.EditSegmenter {
    const segments: Types.EditSegment[] = []
    let buffer: string[] = []
    const pending: string[] = []
    const commitHunk = (): void => {
      if (buffer.length === 0) {
        return
      }
      segments.push({ kind: 'hunk', lines: buffer })
      buffer = []
    }
    const commitKeep = (): void => {
      if (pending.length === 0) {
        return
      }
      segments.push({ kind: 'keep', lines: pending.slice() })
      pending.length = 0
    }
    return {
      feed(line: string): void {
        const indent = Parser.matchMarker(line)
        if (indent !== null) {
          commitHunk()
          if (pending.length === 0 || pending[pending.length - 1] !== indent) {
            pending.push(indent)
          }
          return
        }
        commitKeep()
        buffer.push(line)
      },
      flush(): Types.EditSegment[] {
        commitHunk()
        commitKeep()
        return segments
      },
      segments
    }
  }

  /**
   * Join lines into a string.
   * @description Optionally appends a trailing newline character.
   * @param lines - Lines to join with newline separators
   * @param trailing - Whether to append a trailing newline
   * @returns Joined text with optional trailing newline
   */
  static joinLines(lines: string[], trailing: boolean): string {
    return trailing ? `${lines.join('\n')}\n` : lines.join('\n')
  }

  /**
   * Detect whether line is SKIP marker.
   * @description Falls back to Unicode-folded comparison for confusables.
   * @param line - Line to test against the marker pattern
   * @returns Leading indent of the marker or null when unmatched
   */
  static matchMarker(line: string): string | null {
    if (this.markerPattern.test(line)) {
      return this.indentPattern.exec(line)![0]
    }
    if (!this.markerPattern.test(Unicode.stripZero(Unicode.normalize(line.normalize('NFKC'))))) {
      return null
    }
    return this.indentPattern.exec(line)![0]
  }

  /**
   * Parse an edit body into segments.
   * @description Splits into lines then routes through the segmenter.
   * @param edit - Edit body text to parse
   * @returns Ordered array of parsed edit segments
   */
  static parseEdit(edit: string): Types.EditSegment[] {
    const lines = this.splitLines(edit)
    if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
      return []
    }
    const segmenter = this.createSegmenter()
    for (const line of lines) {
      segmenter.feed(line)
    }
    return segmenter.flush()
  }

  /**
   * Split text into lines cleanly.
   * @description Strips BOM then drops empty last split entry.
   * @param text - Text to split by newline separators
   * @returns Line array without trailing empty entry
   */
  static splitLines(text: string): string[] {
    if (text === '') {
      return []
    }
    const lines = (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text).split('\n')
    if (lines[lines.length - 1] === '') {
      lines.pop()
    }
    return lines
  }
}
