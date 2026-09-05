/**
 * Text folding helpers for anchor matching.
 * @description Normalize confusable glyphs and strip zero-width characters.
 */
export default class Unicode {
  /** Confusable glyphs folded to ASCII */
  private static readonly replacements: Readonly<Record<string, string>> = {
    '\u2010': '-',
    '\u2011': '-',
    '\u2012': '-',
    '\u2013': '-',
    '\u2014': '-',
    '\u2015': '-',
    '\u2212': '-',
    '\uFF0D': '-',
    '\u2018': "'",
    '\u2019': "'",
    '\u201A': "'",
    '\u201B': "'",
    '\u02BC': "'",
    '\uFF07': "'",
    '\u201C': '"',
    '\u201D': '"',
    '\u201E': '"',
    '\u201F': '"',
    '\uFF02': '"',
    '\u2026': '...',
    '\u00A0': ' ',
    '\u2002': ' ',
    '\u2003': ' ',
    '\u2004': ' ',
    '\u2005': ' ',
    '\u2006': ' ',
    '\u2007': ' ',
    '\u2008': ' ',
    '\u2009': ' ',
    '\u200A': ' ',
    '\u202F': ' ',
    '\u205F': ' ',
    '\u3000': ' '
  }
  /** Regex matching any replacement key */
  private static readonly replacer = new RegExp(
    `[${Object.keys(Unicode.replacements).join('')}]`,
    'g'
  )
  /** Regex matching fullwidth ASCII glyphs */
  private static readonly wideAscii = /[\uFF01-\uFF5E]/g
  /** Offset between fullwidth ASCII and ASCII */
  private static readonly wideOffset = 0xfee0
  /** Regex matching zero-width joiner glyphs */
  private static readonly zeroWidth = /[\u200B\u200C\u200D\u2060\uFEFF]/g

  /**
   * Fold text to ASCII-friendly form.
   * @description Applies NFC, fullwidth folding, and replacement table.
   * @param text - Input text to normalize
   * @returns Normalized text with confusables folded
   */
  static normalize(text: string): string {
    return text
      .normalize('NFC')
      .replace(
        this.wideAscii,
        (glyph) => String.fromCharCode(glyph.charCodeAt(0) - this.wideOffset)
      )
      .replace(this.replacer, (glyph) => this.replacements[glyph]!)
  }

  /**
   * Remove zero-width joiner glyphs from text.
   * @description Strips characters that vanish visually but affect matching.
   * @param text - Input text to clean
   * @returns Text without zero-width glyphs
   */
  static stripZero(text: string): string {
    return text.replace(this.zeroWidth, '')
  }
}
