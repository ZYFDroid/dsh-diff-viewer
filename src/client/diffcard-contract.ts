/** Local diff-card derivation for the diff-viewer plugin: the pure projection
 *  from a dispatched or settled Tool block to the hunks the DiffViewer draws.
 *
 *  dsh 0.2.1-rc.2 tool contract: the keyed `tool.call.toolview` owner hands the
 *  component one explicit phase — `preparing` (a named call whose arguments are
 *  still arriving), `start` (dispatched arguments, no result), or `result` (the
 *  settled `ToolResultNode`). Every phase carries the same lazy `args` view over
 *  the call's top-level fields; `preparing` may read it mid-stream, `start` and
 *  `result` read it sealed. A settled block additionally carries the durable
 *  `meta` payload (the tool's `output.presentationMeta` projection, persisted
 *  verbatim).
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { DiffHunk } from './DiffViewer.tsx'

/**
 * The subset of the framework's lazy argument view this plugin reads. Declared
 * structurally so the plugin imports no package at runtime or for types: the
 * view is handed over inside the block, and these four readers are all the
 * diff and row derivations ask of it.
 */
export interface LazyToolArgs {
  /** Whether parsing has seen this top-level field at all. */
  has(key: string): boolean
  /** Whether the field's closing delimiter arrived, so its value is final. */
  complete(key: string): boolean
  /** Decoded length of a string field at the streamed step granularity. */
  stringLength(key: string, options?: { readonly step?: number; readonly offset?: number }): number | undefined
  /** Decoded text of a string field, including a streaming prefix. */
  text(key: string): string | undefined
}

/** The derived diff-card material the renderer draws. */
export interface DiffCardModel {
  card: { diffs: DiffHunk[] }
}

/** Narrow the durable result meta's `diffs` to well-formed hunks (the same
 *  validation the stock diff-card model applies). Optional `oldStart`/
 *  `newStart` — the file-anchored start lines this plugin's host half stamps
 *  onto applied-hunk metadata — pass through untouched when present (a
 *  non-integer or non-positive value is rejected so rendering never trusts a
 *  malformed anchor). */
function narrowDiffs(diffs: unknown): DiffHunk[] | null {
  if (!Array.isArray(diffs) || diffs.length === 0) return null
  for (const hunk of diffs) {
    if (hunk === null || typeof hunk !== 'object') return null
    const { path, oldText, newText, oldStart, newStart } = hunk as Record<string, unknown>
    if (typeof path !== 'string' || (oldText !== null && typeof oldText !== 'string') || typeof newText !== 'string') {
      return null
    }
    const anchorValid = (value: unknown): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value > 0
    if (oldStart !== undefined && !anchorValid(oldStart)) return null
    if (newStart !== undefined && !anchorValid(newStart)) return null
  }
  return diffs as DiffHunk[]
}

/** Parse a frozen `argsRaw` string to an object, or undefined for malformed JSON. */
function parseArgs(argsRaw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** One string-typed argument of a parsed mutation-tool args object. */
function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

/** The call-time diff hunks the mutation tools' own `presentCall` derives from
 *  their arguments: an edit renders its literal old_string→new_string
 *  replacement, a write renders its full content as a create (`oldText: null`,
 *  which also represents an overwrite without prior content). Code Dispatch
 *  sub-calls never carry wire meta (the core short-circuits `presentationMeta`
 *  under a parent execution), so this args fallback is the only diff material
 *  those cards can render — mirroring what the stock row shows for the same
 *  call while running.
 * @param toolName - the wire Tool name ('edit' or 'write').
 * @param argsRaw - the frozen call arguments.
 * @returns the call-time hunks, or null when the tool or its args do not map.
 */
export function callTimeDiffs(toolName: string, argsRaw: string): DiffHunk[] | null {
  const args = parseArgs(argsRaw)
  if (args === undefined) return null
  if (toolName === 'write') {
    const path = stringArg(args, 'file_path')
    const content = stringArg(args, 'content')
    if (path === undefined || content === undefined) return null
    return [{ path, oldText: null, newText: content }]
  }
  if (toolName === 'edit') {
    const path = stringArg(args, 'file_path')
    const oldString = stringArg(args, 'old_string')
    const newString = stringArg(args, 'new_string')
    if (path === undefined || oldString === undefined || newString === undefined) return null
    return [{ path, oldText: oldString || null, newText: newString }]
  }
  return null
}

/**
 * The call-time diff hunks read from the lazy argument view, so one derivation
 * serves every phase of a call. An edit renders its literal old_string→new_string
 * replacement, a write renders its full content as a create (`oldText: null`,
 * which also represents an overwrite without prior content). A field that has
 * not arrived reads as absent, so a streaming call renders the diff it can.
 * @param toolName - the wire Tool name ('edit' or 'write').
 * @param args - the call's lazy argument view.
 * @returns the call-time hunks, or null when the tool or its arguments do not map.
 */
export function callTimeDiffsFromArgs(toolName: string, args: LazyToolArgs): DiffHunk[] | null {
  const path = args.text('file_path')
  if (path === undefined || path === '') return null
  if (toolName === 'write') {
    const content = args.text('content')
    return content === undefined ? null : [{ path, oldText: null, newText: content }]
  }
  if (toolName === 'edit') {
    const oldString = args.text('old_string')
    const newString = args.text('new_string')
    if (oldString === undefined || newString === undefined) return null
    return [{ path, oldText: oldString || null, newText: newString }]
  }
  return null
}

/**
 * The path the CALLER named, for display. Write and edit results record the
 * filesystem execution world's canonical absolute path (the host half reads it
 * off the tool value), while the row's summary and `openFile` both work from the
 * call's own `file_path`; the card renders that same caller-facing path so one
 * card does not name its file two ways. Absent for a settled call whose
 * `tool/call` left the loaded window, where the applied hunks keep their path.
 * @param block - the settled Tool block.
 * @returns the argument path, or undefined when the block carries none.
 */
function displayPathOf(block: ToolCallBlock): string | undefined {
  const fromView = block.args.text('file_path') ?? block.args.text('path')
  if (fromView !== undefined && fromView !== '') return fromView
  const argsRaw = 'kind' in block ? block.call?.argsRaw : block.phase === 'start' ? block.argsRaw : undefined
  const parsed = argsRaw === undefined || argsRaw === '' ? undefined : parseArgs(argsRaw)
  if (parsed === undefined) return undefined
  const picked = stringArg(parsed, 'file_path') ?? stringArg(parsed, 'path')
  return picked === undefined || picked === '' ? undefined : picked
}

/** Rename every hunk to the caller-facing file (write and edit span one file). */
function withDisplayPath(diffs: DiffHunk[], path: string | undefined): DiffHunk[] {
  return path === undefined ? diffs : diffs.map(diff => ({ ...diff, path }))
}

/** Derive the diff-card props for a Tool block, or null when this call is not a
 *  diff card. dsh 0.2.1-rc.2 derivation: a preparing call has no complete
 *  arguments yet, a dispatched call renders the args-derived call-time diff, and
 *  a settled call uses the applied hunks from the durable result `meta` — the
 *  channel the plugin's host half enhances with real line numbers — replacing
 *  the call-time diff, with the args-derived diff as the fallback for a settled
 *  call whose meta is absent (a nested code-dispatch sub-call) or unusable.
 * @param block - the preparing, dispatched, or settled Tool block.
 * @returns the derived diff-card material, or null for the generic path.
 */
export function diffCardModel(block: ToolCallBlock): DiffCardModel | null {
  if (!('kind' in block)) {
    // Preparing: the arguments are still arriving, so there is nothing stable
    // to diff yet — the row shows the path and the streamed input size instead.
    if (block.phase === 'preparing') return null
    const fallback = callTimeDiffsFromArgs(block.name, block.args)
      ?? callTimeDiffs(block.name, block.argsRaw)
    return fallback === null ? null : { card: { diffs: fallback } }
  }
  // Settled: the applied meta hunks (with the host half's oldStart/newStart)
  // replace the call-time diff.
  if (typeof block.meta === 'object' && block.meta !== null && !Array.isArray(block.meta)) {
    const diffs = narrowDiffs((block.meta as Record<string, unknown>).diffs)
    if (diffs !== null) return { card: { diffs: withDisplayPath(diffs, displayPathOf(block)) } }
  }
  // A settled code-dispatch sub-call never carries meta (the core short-circuits
  // `output.presentationMeta` under a parent execution, and a nested dispatch
  // result carries its own kind). Successful mutations fall back to the
  // call-time diff from args; errored ones stay on the generic error path,
  // exactly like the stock row (which surfaces the model-facing error text).
  if (block.isError) return null
  // `name` is the wire tool name even when the paired call head is gone, so a
  // window-truncated result still derives its diff from the argument view.
  const fallback = callTimeDiffsFromArgs(block.name, block.args)
    ?? callTimeDiffs(block.name === '' ? block.call?.name ?? '' : block.name, block.call?.argsRaw ?? '')
  return fallback === null ? null : { card: { diffs: fallback } }
}
