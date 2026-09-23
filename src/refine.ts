import type * as Types from '@app/types.ts'

/**
 * Structured diff builder over line arrays.
 * @description Emits add, delete, and equal records via Myers SES.
 */
export default class Refiner {
  /**
   * Build structured diff between arrays.
   * @description Uses Myers SES, falling back to Hirschberg.
   * @param source - Original source lines
   * @param target - Patched target lines
   * @returns Ordered diff records covering both arrays
   */
  static buildDiff(source: string[], target: string[]): Types.DiffLine[] {
    const height = source.length
    const depth = target.length
    if (height === 0 && depth === 0) {
      return []
    }
    const budget = 64
    let heavy = Math.abs(height - depth) > budget
    if (!heavy) {
      const max = height + depth
      const bias = max
      const frontier = new Int32Array((max << 1) + 1)
      frontier[bias + 1] = 0
      probe: for (let distance = 0; distance <= budget; distance += 1) {
        for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
          const slot = bias + diagonal
          const down = diagonal === -distance ||
            (diagonal !== distance && frontier[slot - 1]! < frontier[slot + 1]!)
          let cursor = down ? frontier[slot + 1]! : frontier[slot - 1]! + 1
          let offset = cursor - diagonal
          while (
            cursor < height &&
            offset < depth &&
            source[cursor] === target[offset]
          ) {
            cursor += 1
            offset += 1
          }
          frontier[slot] = cursor
          if (cursor >= height && offset >= depth) {
            heavy = false
            break probe
          }
          heavy = true
        }
      }
    }
    if (!heavy) {
      return this.myers(source, target)
    }
    const diff: Types.DiffLine[] = []
    let origin = 1
    let goal = 1
    const emit = (type: Types.DiffType, text: string): void => {
      if (type === 'equal') {
        diff.push({ newLine: goal, oldLine: origin, type, value: text })
        origin += 1
        goal += 1
      } else if (type === 'delete') {
        diff.push({ newLine: null, oldLine: origin, type, value: text })
        origin += 1
      } else {
        diff.push({ newLine: goal, oldLine: null, type, value: text })
        goal += 1
      }
    }
    const score = (
      ahead: readonly string[],
      aside: readonly string[],
      top: number,
      bottom: number,
      from: number,
      to: number
    ): Int32Array => {
      const width = to - from
      let prior = new Int32Array(width + 1)
      let active = new Int32Array(width + 1)
      for (let cursor = top; cursor < bottom; cursor += 1) {
        const line = ahead[cursor]!
        for (let column = 1; column <= width; column += 1) {
          active[column] = line === aside[from + column - 1]
            ? prior[column - 1]! + 1
            : Math.max(prior[column]!, active[column - 1]!)
        }
        const spare = prior
        prior = active
        active = spare
        active.fill(0)
      }
      return prior
    }
    const walk = (top: number, bottom: number, from: number, to: number): void => {
      if (top === bottom) {
        for (let column = from; column < to; column += 1) {
          emit('add', target[column]!)
        }
        return
      }
      if (from === to) {
        for (let cursor = top; cursor < bottom; cursor += 1) {
          emit('delete', source[cursor]!)
        }
        return
      }
      if ((bottom - top) * (to - from) <= 64) {
        for (
          const record of this.myers(source.slice(top, bottom), target.slice(from, to))
        ) {
          emit(record.type, record.value)
        }
        return
      }
      const middle = top + ((bottom - top) >> 1)
      const forward = score(source, target, top, middle, from, to)
      const mirror = source.slice(middle, bottom).reverse()
      const echo = target.slice(from, to).reverse()
      const backward = score(
        mirror,
        echo,
        0,
        mirror.length,
        0,
        echo.length
      )
      let best = -1
      let split = from
      const width = to - from
      for (let column = 0; column <= width; column += 1) {
        const gain = forward[column]! + backward[width - column]!
        if (gain > best) {
          best = gain
          split = from + column
        }
      }
      walk(top, middle, from, split)
      walk(middle, bottom, split, to)
    }
    walk(0, source.length, 0, target.length)
    return diff
  }

  /**
   * Build a short Myers edit script.
   * @description Stores the full frontier trace for small edit distances.
   * @param source - Original source lines
   * @param target - Patched target lines
   * @returns Ordered diff records covering both arrays
   */
  private static myers(source: string[], target: string[]): Types.DiffLine[] {
    const height = source.length
    const depth = target.length
    const max = height + depth
    const bias = max
    const width = (max << 1) + 1
    const trace: Int32Array[] = []
    const frontier = new Int32Array(width)
    frontier[bias + 1] = 0
    let distance = 0
    search: for (distance = 0; distance <= max; distance += 1) {
      trace.push(frontier.slice())
      for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
        const slot = bias + diagonal
        const down = diagonal === -distance ||
          (diagonal !== distance && frontier[slot - 1]! < frontier[slot + 1]!)
        let cursor = down ? frontier[slot + 1]! : frontier[slot - 1]! + 1
        let offset = cursor - diagonal
        while (
          cursor < height &&
          offset < depth &&
          source[cursor] === target[offset]
        ) {
          cursor += 1
          offset += 1
        }
        frontier[slot] = cursor
        if (cursor >= height && offset >= depth) {
          break search
        }
      }
    }
    const script: Array<readonly ['add' | 'delete' | 'equal', number, number]> = []
    let cursor = height
    let offset = depth
    for (let step = distance; step > 0; step -= 1) {
      const previous = trace[step]!
      const diagonal = cursor - offset
      const down = diagonal === -step ||
        (diagonal !== step && previous[bias + diagonal - 1]! < previous[bias + diagonal + 1]!)
      const bend = down ? diagonal + 1 : diagonal - 1
      const prior = previous[bias + bend]!
      const next = prior - bend
      while (cursor > prior && offset > next) {
        cursor -= 1
        offset -= 1
        script.push(['equal', cursor, offset])
      }
      if (down) {
        offset -= 1
        script.push(['add', cursor, offset])
      } else {
        cursor -= 1
        script.push(['delete', cursor, offset])
      }
    }
    while (cursor > 0 && offset > 0) {
      cursor -= 1
      offset -= 1
      script.push(['equal', cursor, offset])
    }
    const diff: Types.DiffLine[] = []
    let origin = 1
    let goal = 1
    for (let index = script.length - 1; index >= 0; index -= 1) {
      const edit = script[index]!
      if (edit[0] === 'equal') {
        diff.push({ newLine: goal, oldLine: origin, type: 'equal', value: source[edit[1]]! })
        origin += 1
        goal += 1
      } else if (edit[0] === 'delete') {
        diff.push({ newLine: null, oldLine: origin, type: 'delete', value: source[edit[1]]! })
        origin += 1
      } else {
        diff.push({ newLine: goal, oldLine: null, type: 'add', value: target[edit[2]]! })
        goal += 1
      }
    }
    return diff
  }
}
