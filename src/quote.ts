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
    let reference: string | null = null
    if (line.length > 0) {
      if (target.indexOf(line) !== -1) {
        reference = line
      } else {
        const index = Unicode.normalize(target).indexOf(Unicode.normalize(line))
        if (index !== -1) {
          reference = target.substring(index, index + line.length)
        }
      }
    }
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
    let quoted = false
    for (let index = 0; index < chars.length; index += 1) {
      const glyph = chars[index]!
      if (glyph === '`') {
        quoted = !quoted
        result[index] = glyph
        continue
      }
      if (quoted || glyph !== mark) {
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
    const doubled = reference.includes(this.leftDouble) || reference.includes(this.rightDouble)
    const singled = reference.includes(this.leftSingle) || reference.includes(this.rightSingle)
    if (!doubled && !singled) {
      return line
    }
    let styled = line
    if (doubled) {
      styled = this.curlify(styled, '"', this.leftDouble, this.rightDouble)
    }
    if (singled) {
      styled = this.curlify(styled, "'", this.leftSingle, this.rightSingle)
    }
    return styled
  }
}
