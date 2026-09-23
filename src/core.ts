import type * as Types from '@app/types.ts'
import Parser from '@app/parser.ts'
import Refiner from '@app/refine.ts'
import Pipeline from '@app/pipeline.ts'

/**
 * Core apply and stream orchestration.
 * @description Wires parser, pipeline, and refiner into user APIs.
 */
export default class Core {
  /**
   * Apply edit body to source.
   * @description Runs full pipeline and returns result bundle.
   * @param original - Original source text before patching
   * @param edit - Edit body containing hunk segments
   * @param timeout - Deadline budget in milliseconds
   * @returns Apply result with before, after, and diff
   * @throws RangeError When the deadline budget elapses
   * @throws SyntaxError When placements reject or overlap
   */
  static applyCore(original: string, edit: string, timeout: number): Types.ApplyResult {
    const source = original.replace(/\r\n?/g, '\n')
    const trailing = source.endsWith('\n')
    const lines = Parser.splitLines(source)
    const segments = Parser.parseEdit(edit.replace(/\r\n?/g, '\n'))
    const indexes = Pipeline.collectHunks(segments)
    if (indexes.length === 0) {
      return { after: source, before: source, diff: Refiner.buildDiff(lines, lines) }
    }
    const deadline: Types.DeadlineWindow | null = Number.isFinite(timeout)
      ? { limit: timeout, start: performance.now() }
      : null
    Pipeline.checkDeadline(deadline)
    const placements = Pipeline.locate(segments, lines, indexes, deadline)
    Pipeline.checkDeadline(deadline)
    const merged = Pipeline.assemble(segments, lines, placements, indexes).output
    const after = Parser.joinLines(merged, trailing)
    return { after, before: source, diff: Refiner.buildDiff(lines, merged) }
  }

  /**
   * Open a streaming apply session.
   * @description Feeds chunked edit text and emits patches per hunk.
   * @param original - Original source text before patching
   * @param timeout - Idle timeout in milliseconds
   * @returns Stream handle with callback, push, and end
   * @throws TypeError When push receives a non-string chunk
   * @throws RangeError When the idle timeout elapses
   */
  static streamCore(original: string, timeout: number): Types.StreamHandle {
    const source = original.replace(/\r\n?/g, '\n')
    const ending = source.endsWith('\n')
    const origin = Parser.splitLines(source)
    const state: Types.StreamState = {
      backlog: [],
      buffer: '',
      callback: null,
      closed: false,
      errored: false,
      pendingCR: false,
      pushed: false,
      scan: 0,
      segmenter: Parser.createSegmenter(),
      timedOut: false
    }
    const deliver = (listener: Types.HunkListener, hunk: Types.ApplyResult): void => {
      try {
        listener(hunk)
      } catch (error) {
        state.errored = true
        state.backlog.length = 0
        throw error
      }
    }
    const emit = (hunk: Types.ApplyResult): void => {
      if (state.errored) {
        return
      }
      if (state.callback) {
        deliver(state.callback, hunk)
      } else {
        state.backlog.push(hunk)
      }
    }
    const idle = Pipeline.scheduleIdle(timeout, () => {
      if (state.closed) {
        return
      }
      state.timedOut = true
      state.closed = true
    })
    return {
      callback(listener) {
        if (listener !== null && typeof listener !== 'function') {
          throw new TypeError('stream callback argument must be a function or null')
        }
        state.callback = listener
        if (listener && !state.errored && state.backlog.length > 0) {
          while (state.backlog.length > 0) {
            deliver(listener, state.backlog.shift()!)
          }
        }
      },
      end() {
        if (state.timedOut) {
          throw new RangeError(`stream idle timeout of ${timeout}ms has elapsed`)
        }
        if (state.closed) {
          return
        }
        idle.clear()
        state.closed = true
        if (state.pendingCR) {
          state.buffer = `${state.buffer}\n`
          state.pendingCR = false
        }
        if (state.scan < state.buffer.length) {
          const tail = state.buffer.substring(state.scan).replace(/\r\n?/g, '\n')
          if (tail.length > 0) {
            state.segmenter.feed(tail)
          }
          state.buffer = ''
          state.scan = 0
        }
        if (!state.pushed) {
          return
        }
        const segments = state.segmenter.flush()
        const indexes = Pipeline.collectHunks(segments)
        if (indexes.length === 0) {
          if (origin.length > 0) {
            emit({
              before: source,
              after: source,
              diff: Refiner.buildDiff(origin, origin)
            })
          }
          return
        }
        const places = Pipeline.locate(segments, origin, indexes, null)
        const { output, hunkEnd: stops } = Pipeline.assemble(segments, origin, places, indexes)
        const script = Refiner.buildDiff(origin, output)
        let from = 0
        let into = 0
        let mark = 0
        for (let rank = 0; rank < indexes.length; rank += 1) {
          const spot = places[indexes[rank]!]!.spot
          const final = rank === indexes.length - 1
          const stop = final ? origin.length : spot.sourceEnd
          const until = final ? output.length : stops[rank]!
          const past = origin.slice(from, stop)
          const next = output.slice(into, until)
          let edge = mark
          while (edge < script.length) {
            const record = script[edge]!
            if (
              (record.oldLine !== null && record.oldLine > stop) ||
              (record.newLine !== null && record.newLine > until)
            ) {
              break
            }
            edge += 1
          }
          const trailing = final ? ending : true
          emit({
            before: Parser.joinLines(past, trailing && past.length > 0),
            after: Parser.joinLines(next, trailing && next.length > 0),
            diff: script.slice(mark, edge)
          })
          from = spot.sourceEnd
          into = until
          mark = edge
        }
      },
      push(chunk) {
        if (timeout === 0 || state.timedOut) {
          throw new RangeError(`stream idle timeout of ${timeout}ms has elapsed`)
        }
        if (state.closed) {
          throw new TypeError('stream is already closed and rejects further pushes')
        }
        if (typeof chunk !== 'string') {
          throw new TypeError(`stream push chunk must be a string but got ${typeof chunk}`)
        }
        state.pushed = true
        idle.reset()
        if (chunk.length === 0) {
          return
        }
        if (state.pendingCR) {
          chunk = `\r${chunk}`
          state.pendingCR = false
        }
        if (chunk.charCodeAt(chunk.length - 1) === 0x0d) {
          state.pendingCR = true
          chunk = chunk.substring(0, chunk.length - 1)
          if (chunk.length === 0) {
            return
          }
        }
        state.buffer = `${state.buffer}${chunk.replace(/\r\n?/g, '\n')}`
        let newline = state.buffer.indexOf('\n', state.scan)
        while (newline !== -1) {
          state.segmenter.feed(state.buffer.substring(state.scan, newline))
          state.scan = newline + 1
          newline = state.buffer.indexOf('\n', state.scan)
        }
        if (state.scan > 0) {
          state.buffer = state.buffer.substring(state.scan)
          state.scan = 0
        }
      }
    }
  }
}
