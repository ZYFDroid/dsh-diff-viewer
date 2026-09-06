/** Local toolview contract for the diff-viewer plugin: the owner currency the
 *  stock ui-tool rows supply at `tool.call.toolview` and the pure diff-card
 *  derivation, declared locally so this plugin never imports the stock ui-tool
 *  contract (one-way dependency). The `declare module` merge restores the slot
 *  key this plugin registers into — the stock ui-tool bundle declares the same
 *  row with the same shape, and interface merging accepts the duplicate
 *  identical declaration.
 *
 *  dsh 0.1.2+ contract: the `@deepseek-ai/dsh-client-runtime` package (which
 *  used to re-export the conversation block types) was removed upstream, and
 *  the Host `presentCall`/`presentResult` wire views no longer enter the
 *  Client. The runtime block types live in `dsh-client-ui-chat/client`, and a
 *  settled card derives from the durable `tool/result` `meta` payload (the
 *  tool's `output.presentationMeta` projection, persisted verbatim). */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { DiffHunk } from './DiffViewer.tsx'

/** What the stock ui-tool rows pass to the `tool.call.toolview` keyed slots. */
export interface ToolCallOwnerProps {
  /** Tool call identity, stable across running and settled forms. */
  callId: string
  /** Wire Tool name and keyed dispatch value. */
  toolName: string
  /** Frozen running call or settled result node. */
  block: ToolCallBlock
  /** Session workspace root for relative summaries. */
  cwd?: string | undefined
  /** Host account home; POSIX home-rooted summaries display as `~`. */
  home?: string | undefined
  /** Open a Tool argument path through the Host. */
  openFile: (path: string) => void
  /** Inspect this call in the trajectory view when available. */
  inspect?: (() => void) | undefined
}

/** The derived diff-card material the renderer draws. */
export interface DiffCardModel {
  card: { diffs: DiffHunk[] }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Keyed atomic Tool call view (declared by the stock ui-tool chat tree). */
    'tool.call.toolview': { kind: 'keyed'; scope: 'session'; owner: ToolCallOwnerProps }
  }
}

/** Narrow a wire `card:'diff'` view's `diffs` to well-formed hunks (same
 *  validation the stock diff-card model applies). Optional `oldStart`/
 *  `newStart` — the file-anchored start lines the plugin's host half stamps
 *  onto applied-hunk metadata — pass through untouched when present (a
 *  non-number or negative value is rejected so rendering never trusts a
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

/** The wire Tool name of a frozen call block, when the block still carries it. */
function callToolName(block: ToolCallBlock): string {
  return 'kind' in block ? block.call?.name ?? '' : block.name
}

/** Derive the diff-card props for a tool call, or null when this call is not a
 *  diff card. dsh 0.1.2+ derivation: running calls use the args-derived
 *  call-time diff (there is no wire call view); settled calls use the applied
 *  hunks from the durable result `meta` — the channel the plugin's host half
 *  enhances with real line numbers — and replace the call-time diff. */
export function diffCardModel(block: ToolCallBlock): DiffCardModel | null {
  const toolName = callToolName(block)
  if (!('kind' in block)) {
    // Running: no wire call view exists; the args carry the intended change.
    const fallback = callTimeDiffs(toolName, block.argsRaw)
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
  const fallback = callTimeDiffs(toolName, block.call?.argsRaw ?? '')
  return fallback === null ? null : { card: { diffs: fallback } }
}
