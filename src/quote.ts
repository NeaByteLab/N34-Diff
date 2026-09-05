import Unicode from '@app/unicode.ts'

/**
 * Restore curly quote style from target.
 * @description Preserves smart quotes when merging fuzzy replacements.
 */
export default class Quote {
  /** Regex matching any curly quote glyph */
  private static readonly curly = /[\u2018\u2019\u201C\u201D]/
  /** Left curly double quote glyph */
  private static readonly leftDouble = '\u201C'
  /** Left curly single quote glyph */
  private static readonly leftSingle = '\u2018'
  /** Regex matching any Unicode letter */
  private static readonly letter = /\p{L}/u
  /** Characters counted as opening context */
  private static readonly openers = new Set([
    ' ',
    '\t',
    '\n',
    '\r',
    '(',
    '[',
    '{',
    '-',
    '\u2014',
    '\u2013'
  ])
  /** Right curly double quote glyph */
  private static readonly rightDouble = '\u201D'
  /** Right curly single quote glyph */
  private static readonly rightSingle = '\u2019'
  /** Regex matching straight ASCII quote glyphs */
  private static readonly straight = /["']/

  /**
   * Restyle line quotes to target.
   * @description Copies curly quote style from the reference line.
   * @param line - Candidate line whose quotes may be restyled
   * @param target - Reference line that provides quote style
   * @returns Line with quote glyphs aligned to target
   */
  static restyle(line: string, target: string): string {
    if (!this.straight.test(line) && !this.curly.test(line)) {
      return line
    }
    const reference = this.locate(target, line)
    if (reference !== null) {
      return this.preserve(line, reference)
    }
    if (this.curly.test(target)) {
      return this.preserve(line, target)
    }
    return line
  }

  /**
   * Convert straight marks to curly variants.
   * @description Applies open or close glyph based on neighbor context.
   * @param text - Source text scanned per character
   * @param mark - Straight mark to convert
   * @param left - Opening curly variant
   * @param right - Closing curly variant
   * @returns Text with straight marks replaced by curly variants
   */
  private static curlify(text: string, mark: string, left: string, right: string): string {
    const chars = [...text]
    const result: string[] = new Array(chars.length)
    let insideBacktick = false
    for (let index = 0; index < chars.length; index += 1) {
      const glyph = chars[index]!
      if (glyph === '`') {
        insideBacktick = !insideBacktick
        result[index] = glyph
        continue
      }
      if (insideBacktick || glyph !== mark) {
        result[index] = glyph
        continue
      }
      if (mark === "'") {
        const previous = chars[index - 1]
        const next = chars[index + 1]
        if (previous && next && this.letter.test(previous) && this.letter.test(next)) {
          result[index] = mark
          continue
        }
      }
      result[index] = index === 0 || this.openers.has(chars[index - 1]!) ? left : right
    }
    return result.join('')
  }

  /**
   * Find needle inside source text.
   * @description Falls back to Unicode-normalized comparison on miss.
   * @param source - Source text to search inside
   * @param needle - Needle text to locate
   * @returns Matched substring from source or null
   */
  private static locate(source: string, needle: string): string | null {
    if (needle.length === 0) {
      return null
    }
    if (source.indexOf(needle) !== -1) {
      return needle
    }
    const index = Unicode.normalize(source).indexOf(Unicode.normalize(needle))
    if (index === -1) {
      return null
    }
    return source.substring(index, index + needle.length)
  }

  /**
   * Copy curly quote style from reference.
   * @description Restyles line quotes to match reference glyphs used.
   * @param line - Line whose quote style is being replaced
   * @param reference - Reference line providing target quote style
   * @returns Line restyled to reference quote glyphs
   */
  private static preserve(line: string, reference: string): string {
    if (line === reference) {
      return line
    }
    const hasDouble = reference.includes(this.leftDouble) || reference.includes(this.rightDouble)
    const hasSingle = reference.includes(this.leftSingle) || reference.includes(this.rightSingle)
    if (!hasDouble && !hasSingle) {
      return line
    }
    let styled = line
    if (hasDouble) {
      styled = this.curlify(styled, '"', this.leftDouble, this.rightDouble)
    }
    if (hasSingle) {
      styled = this.curlify(styled, "'", this.leftSingle, this.rightSingle)
    }
    return styled
  }
}
