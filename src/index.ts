import type * as Types from '@app/types.ts'
import Core from '@app/core.ts'

/**
 * Public entry point for N34.
 * @description Exposes apply and stream over a shared timeout.
 */
export default class N34 {
  /** Default timeout when options omit */
  private static readonly defaultTimeout = 60000

  /**
   * Apply edit body to source.
   * @description Validates inputs and delegates to core apply.
   * @param original - Original source text before patching
   * @param edit - Edit body containing hunk segments
   * @param options - Optional apply options
   * @returns Apply result with before, after, and diff
   * @throws TypeError When any argument has the wrong type
   * @throws RangeError When timeout is invalid or elapses
   */
  static apply(original: string, edit: string, options?: Types.ApplyOption): Types.ApplyResult {
    if (typeof original !== 'string') {
      throw new TypeError(`apply original argument must be a string but got ${typeof original}`)
    }
    if (typeof edit !== 'string') {
      throw new TypeError(`apply edit argument must be a string but got ${typeof edit}`)
    }
    const timeout = this.resolveTimeout(options)
    return Core.applyCore(original, edit, timeout)
  }

  /**
   * Open streaming apply session.
   * @description Validates inputs and delegates to core stream.
   * @param original - Original source text before patching
   * @param options - Optional stream options
   * @returns Stream handle with callback, push, and end
   * @throws TypeError When any argument has the wrong type
   * @throws RangeError When timeout is invalid
   */
  static stream(original: string, options?: Types.ApplyOption): Types.StreamHandle {
    if (typeof original !== 'string') {
      throw new TypeError(`stream original argument must be a string but got ${typeof original}`)
    }
    const timeout = this.resolveTimeout(options)
    return Core.streamCore(original, timeout)
  }

  /**
   * Resolve timeout from options.
   * @description Validates option shape and clamps invalid values.
   * @param input - Raw user options argument
   * @returns Timeout in milliseconds or positive infinity
   * @throws TypeError When options or timeout has the wrong type
   * @throws RangeError When timeout is NaN or negative
   */
  private static resolveTimeout(input: unknown): number {
    if (input === undefined) {
      return this.defaultTimeout
    }
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError(
        `options argument must be a plain object but got ${
          input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input
        }`
      )
    }
    const timeout = (input as { timeout?: unknown }).timeout
    if (timeout === undefined) {
      return this.defaultTimeout
    }
    if (typeof timeout !== 'number') {
      throw new TypeError(`options timeout must be a number but got ${typeof timeout}`)
    }
    if (Number.isNaN(timeout)) {
      throw new RangeError('options timeout must not be NaN')
    }
    if (!Number.isFinite(timeout)) {
      return Number.POSITIVE_INFINITY
    }
    if (timeout < 0) {
      throw new RangeError(`options timeout must be zero or greater but got ${timeout}`)
    }
    return timeout
  }
}

/** Re-export all public types */
export type * from '@app/types.ts'
