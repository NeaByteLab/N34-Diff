import type * as Types from '@app/types.ts'

/**
 * Structured diff builder over line arrays.
 * @description Emits add, delete, and equal records via LCS.
 */
export default class Refiner {
  /**
   * Build structured diff between arrays.
   * @description Uses longest common subsequence to align lines.
   * @param source - Original source lines
   * @param target - Patched target lines
   * @returns Ordered diff records covering both arrays
   */
  static buildDiff(source: string[], target: string[]): Types.DiffLine[] {
    const diff: Types.DiffLine[] = []
    let sourceIndex = 0
    let targetIndex = 0
    let oldLine = 1
    let newLine = 1
    if (source.length > 0 && target.length > 0) {
      const width = target.length + 1
      const table = new Int32Array((source.length + 1) * width)
      for (let row = source.length - 1; row >= 0; row -= 1) {
        const start = row * width
        for (let col = target.length - 1; col >= 0; col -= 1) {
          table[start + col] = source[row]! === target[col]
            ? table[start + width + col + 1]! + 1
            : Math.max(table[start + width + col]!, table[start + col + 1]!)
        }
      }
      while (sourceIndex < source.length && targetIndex < target.length) {
        const sourceLine = source[sourceIndex]!
        const targetLine = target[targetIndex]!
        if (sourceLine === targetLine) {
          diff.push({ type: 'equal', value: sourceLine, oldLine, newLine })
          sourceIndex += 1
          targetIndex += 1
          oldLine += 1
          newLine += 1
          continue
        }
        if (
          table[(sourceIndex + 1) * width + targetIndex]! >=
            table[sourceIndex * width + targetIndex + 1]!
        ) {
          diff.push({ type: 'delete', value: sourceLine, oldLine, newLine: null })
          sourceIndex += 1
          oldLine += 1
        } else {
          diff.push({ type: 'add', value: targetLine, oldLine: null, newLine })
          targetIndex += 1
          newLine += 1
        }
      }
    }
    while (sourceIndex < source.length) {
      diff.push({ type: 'delete', value: source[sourceIndex]!, oldLine, newLine: null })
      sourceIndex += 1
      oldLine += 1
    }
    while (targetIndex < target.length) {
      diff.push({ type: 'add', value: target[targetIndex]!, oldLine: null, newLine })
      targetIndex += 1
      newLine += 1
    }
    return diff
  }
}
