/** Local diff-card derivation for the diff-viewer plugin: the pure projection
 *  from a dispatched or settled Tool block to the hunks the DiffViewer draws.
 *
 *  dsh 0.2.0-rc.2 tool contract: the keyed `tool.call.toolview` owner hands the
 *  component one explicit phase — `preparing` (a named call whose arguments have
 *  not arrived), `start` (dispatched arguments, no result), or `result` (the
 *  settled `ToolResultNode`). A preparing block carries no arguments, a started
 *  block carries them on `argsRaw` directly, and a settled block carries both
 *  the backfilled call head and the durable `meta` payload (the tool's
 *  `output.presentationMeta` projection, persisted verbatim).
 */
import type {
  PreparingToolCall, StartedToolCall, ToolCallBlock, ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { DiffHunk } from './DiffViewer.tsx'

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

/** The wire Tool name of a dispatched (unsettled) call. */
function runningToolName(block: PreparingToolCall | StartedToolCall): string {
  return block.name
}

/** The wire Tool name of a settled call, when the call head is still in the
 *  window (a window cut leaves `call` null and the card has no diff material). */
function settledToolName(block: ToolResultNode): string {
  return block.call?.name ?? ''
}

/** Derive the diff-card props for a Tool block, or null when this call is not a
 *  diff card. dsh 0.2.0-rc.2 derivation: a preparing call has no arguments yet,
 *  a dispatched call renders the args-derived call-time diff, and a settled call
 *  uses the applied hunks from the durable result `meta` — the channel the
 *  plugin's host half enhances with real line numbers — replacing the call-time
 *  diff, with the args-derived diff as the fallback for a settled call whose
 *  meta is absent (a nested code-dispatch sub-call) or unusable.
 * @param block - the preparing, dispatched, or settled Tool block.
 * @returns the derived diff-card material, or null for the generic path.
 */
export function diffCardModel(block: ToolCallBlock): DiffCardModel | null {
  if (!('kind' in block)) {
    // Preparing: the model named the tool but its arguments have not arrived,
    // so there is nothing to diff yet.
    if (block.phase === 'preparing') return null
    const fallback = callTimeDiffs(runningToolName(block), block.argsRaw)
    return fallback === null ? null : { card: { diffs: fallback } }
  }
  // Settled: the applied meta hunks (with the host half's oldStart/newStart)
  // replace the call-time diff.
  if (typeof block.meta === 'object' && block.meta !== null && !Array.isArray(block.meta)) {
    const diffs = narrowDiffs((block.meta as Record<string, unknown>).diffs)
    if (diffs !== null) return { card: { diffs } }
  }
  // A settled code-dispatch sub-call never carries meta (the core skips
  // `output.presentationMeta` under a parent execution). Successful mutations
  // fall back to the call-time diff from args; errored ones stay on the
  // generic error path, exactly like the stock row (which surfaces the
  // model-facing error text).
  if (block.isError) return null
  const fallback = callTimeDiffs(settledToolName(block), block.call?.argsRaw ?? '')
  return fallback === null ? null : { card: { diffs: fallback } }
}
