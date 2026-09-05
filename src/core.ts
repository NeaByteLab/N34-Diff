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
    const hunkAt = Pipeline.collectHunks(segments)
    if (hunkAt.length === 0) {
      return { before: source, after: source, diff: Refiner.buildDiff(lines, lines) }
    }
    const deadline: Types.DeadlineWindow | null = Number.isFinite(timeout)
      ? { start: performance.now(), limit: timeout }
      : null
    Pipeline.checkDeadline(deadline)
    const placements = Pipeline.locate(segments, lines, hunkAt, deadline)
    Pipeline.checkDeadline(deadline)
    const merged = Pipeline.assemble(segments, lines, placements, hunkAt).output
    const after = Parser.joinLines(merged, trailing)
    return { before: source, after, diff: Refiner.buildDiff(lines, merged) }
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
    const sourceTrailing = source.endsWith('\n')
    const sourceLines = Parser.splitLines(source)
    const state: Types.StreamState = {
      buffer: '',
      pendingCR: false,
      segmenter: Parser.createSegmenter(),
      backlog: [],
      callback: null,
      closed: false,
      timedOut: false,
      pushed: false,
      errored: false
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
    const finalize = (): void => {
      if (!state.pushed) {
        return
      }
      const segments = state.segmenter.flush()
      const hunkAt = Pipeline.collectHunks(segments)
      if (hunkAt.length === 0) {
        if (sourceLines.length > 0) {
          emit({
            before: source,
            after: source,
            diff: Refiner.buildDiff(sourceLines, sourceLines)
          })
        }
        return
      }
      const places = Pipeline.locate(segments, sourceLines, hunkAt, null)
      const { output, hunkEnd } = Pipeline.assemble(segments, sourceLines, places, hunkAt)
      const fullDiff = Refiner.buildDiff(sourceLines, output)
      let sourceCursor = 0
      let outputCursor = 0
      let diffCursor = 0
      for (let index = 0; index < hunkAt.length; index += 1) {
        const spot = places[hunkAt[index]!]!.spot
        const isLast = index === hunkAt.length - 1
        const sourceEnd = isLast ? sourceLines.length : spot.sourceEnd
        const outputEnd = isLast ? output.length : hunkEnd[index]!
        const beforeLines = sourceLines.slice(sourceCursor, sourceEnd)
        const afterLines = output.slice(outputCursor, outputEnd)
        let diffEnd = diffCursor
        while (diffEnd < fullDiff.length) {
          const record = fullDiff[diffEnd]!
          if (
            (record.oldLine !== null && record.oldLine > sourceEnd) ||
            (record.newLine !== null && record.newLine > outputEnd)
          ) {
            break
          }
          diffEnd += 1
        }
        const trailing = isLast ? sourceTrailing : true
        emit({
          before: Parser.joinLines(beforeLines, trailing && beforeLines.length > 0),
          after: Parser.joinLines(afterLines, trailing && afterLines.length > 0),
          diff: fullDiff.slice(diffCursor, diffEnd)
        })
        sourceCursor = spot.sourceEnd
        outputCursor = outputEnd
        diffCursor = diffEnd
      }
    }
    const idle = Pipeline.scheduleIdle(timeout, () => {
      if (state.closed) {
        return
      }
      state.timedOut = true
      state.closed = true
    })
    const guardOpen = (): void => {
      if (state.timedOut) {
        throw new RangeError(`stream idle timeout of ${timeout}ms has elapsed`)
      }
      if (state.closed) {
        throw new TypeError('stream is already closed and rejects further pushes')
      }
    }
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
          state.buffer += '\n'
          state.pendingCR = false
        }
        if (state.buffer.length > 0) {
          state.segmenter.feed(state.buffer)
          state.buffer = ''
        }
        finalize()
      },
      push(chunk) {
        guardOpen()
        if (typeof chunk !== 'string') {
          throw new TypeError(`stream.push chunk must be a string but got ${typeof chunk}`)
        }
        state.pushed = true
        idle.reset()
        if (chunk.length === 0) {
          return
        }
        let normalized = chunk
        if (state.pendingCR) {
          normalized = `\r${normalized}`
          state.pendingCR = false
        }
        if (normalized.charCodeAt(normalized.length - 1) === 0x0d) {
          state.pendingCR = true
          normalized = normalized.substring(0, normalized.length - 1)
        }
        state.buffer += normalized.replace(/\r\n?/g, '\n')
        let newline = state.buffer.indexOf('\n')
        while (newline !== -1) {
          state.segmenter.feed(state.buffer.substring(0, newline))
          state.buffer = state.buffer.substring(newline + 1)
          newline = state.buffer.indexOf('\n')
        }
      }
    }
  }
}
