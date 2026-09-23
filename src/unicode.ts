/**
 * Text folding helpers for anchor matching.
 * @description Normalize confusable glyphs and strip zero-width characters.
 */
export default class Unicode {
  /** Regex matching zero-width joiner glyphs */
  static readonly zeroWidth = /[\u200B\u200C\u200D\u2060\uFEFF]/g
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
  /** Offset between fullwidth ASCII and ASCII */
  private static readonly wideOffset = 0xfee0

  /**
   * Fold text to ASCII-friendly form.
   * @description Applies NFC, fullwidth folding, and replacement table.
   * @param text - Input text to normalize
   * @returns Normalized text with confusables folded
   */
  static normalize(text: string): string {
    for (let index = 0; index < text.length; index += 1) {
      if (text.charCodeAt(index) >= 0x80) {
        text = text.normalize('NFC')
        let folded = ''
        let start = 0
        for (let cursor = 0; cursor < text.length; cursor += 1) {
          const code = text.charCodeAt(cursor)
          const wide = code >= 0xff01 && code <= 0xff5e
            ? String.fromCharCode(code - this.wideOffset)
            : undefined
          const piece = wide ?? this.replacements[text[cursor]!]
          if (piece === undefined) {
            continue
          }
          folded = `${folded}${text.slice(start, cursor)}${piece}`
          start = cursor + 1
        }
        return start === 0 ? text : `${folded}${text.slice(start)}`
      }
    }
    return text
  }
}
