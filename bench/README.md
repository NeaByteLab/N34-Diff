# Benchmarks

Micro-benchmarks for `N34.apply` and `N34.stream` throughput.

## Files

| File                                   | What it measures                                                        |
| -------------------------------------- | ----------------------------------------------------------------------- |
| [`apply.bench.ts`](./apply.bench.ts)   | Full corpus, per-language, and synthetic line-count scaling for `apply` |
| [`stream.bench.ts`](./stream.bench.ts) | Edge-case corpus, per-spec, and chunk-width scaling for `stream`        |
| [`output.txt`](./output.txt)           | Reference run captured on Apple M3 Pro, Deno 2.9.5                      |

## Run

```bash
deno task bench
```

Or bench one file directly:

```bash
deno bench --allow-read bench/apply.bench.ts
deno bench --allow-read bench/stream.bench.ts
```

## Corpora

- `apply` reads specs from [`tests/code/`](../tests/code/) - 100 language samples across the file corpus.
- `stream` reads chunk specs from [`tests/edge/`](../tests/edge/) - edge cases covering wrappers, whitespace, and streaming shapes.

Synthetic ladders (64 / 256 / 1024 / 4096 lines) verify scaling. Stream bench also sweeps chunk widths (1 / 16 / 256) to mimic LLM token cadence.

## Notes

- No network calls, all inputs load from local test JSON.
- `apply corpus` and `stream corpus` groups run as baselines for relative iter/s.
- Timings vary with CPU load and thermal state; treat `output.txt` as a snapshot, not a contract.
