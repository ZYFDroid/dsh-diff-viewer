/**
 * Host loader entry for the dsh-diff-viewer plugin.
 *
 * The browser diff surface wants FILE-TRUTHFUL line numbers for applied
 * write/edit hunks. The core tool contract ships hunks as bare text
 * (`{ path, oldText, newText }` — tool-fs computes each hunk's start line
 * then discards it), so no wire field carries the positions a line-number
 * gutter needs.
 *
 * This host half closes that gap WITHOUT touching core: for every agent
 * composed after this plugin loads, it re-registers the `edit`/`write`
 * definitions through that agent's OWN layer (`agent.ctx` — the documented
 * shadowing seat: an agent's own-layer registration wins over the preset
 * standing layer's same-named tool, and plain duplicate registration on the
 * same layer is what the registry rejects, so the agent seat is the only
 * supported override point). The shadow COPY delegates every behavior
 * (`schema`/`render`/`execute`/`presentCall`/`presentResult`/`finalizeContent`)
 * verbatim to the original definition and swaps only `output.presentationMeta`
 * for one that recomputes the hunks with the SAME `structuredPatch` the core
 * uses, stamping each hunk's `oldStart`/`newStart` (the file positions
 * `structuredPatch` already computes) onto the meta diffs.
 *
 * Those extra fields ride the durable `tool/result` meta, pass through the
 * core's own narrowers (`diffsFromMeta` validates only path/oldText/newText)
 * and the client's `narrowDiffs` untouched, and reach the browser's
 * DiffViewer: it renders real line numbers when anchors are present and
 * hides the gutter when they are absent (older session logs, nested PTC
 * sub-calls — whose meta the core never computes).
 */

import { structuredPatch } from 'diff'

/** The context surface this host half touches (cordis Context plus the tools
 *  and scope integration the core merges in; declared minimally so the plugin
 *  stays free of any core package import). */
interface PluginContext {
  on(event: 'agent/created', listener: (payload: { agent: AgentLike }) => void): () => void
  effect(callback: () => () => void, label?: string): () => void
}

/** An agent as `agent/created` hands it: the scope key that owns the ctx. */
interface AgentLike {
  ctx: AgentContext
}

/** The scoped context whose own layer shadows the preset standing layer. */
interface AgentContext {
  tools: ToolsService
  effect(callback: () => () => void, label?: string): () => void
}

/** The tool registry face this plugin uses. */
interface ToolsService {
  /** Resolve the definition visible to THIS scope (agent-layer-aware view). */
  get(name: string, scope?: object): ToolDefinitionLike | undefined
  /** Register into the CALLING context's layer (agent.ctx → agent's own layer). */
  register(definition: ToolDefinitionLike): () => void
}

/** The fraction of a registered tool this wrapper clones. */
interface ToolDefinitionLike {
  name: string
  output: {
    schema?: unknown
    render?: (...args: unknown[]) => unknown
    presentationMeta?: (args: unknown, value: unknown) => unknown
  }
  execute?: (...args: unknown[]) => Promise<unknown>
  presentCall?: (...args: unknown[]) => unknown
  presentResult?: (...args: unknown[]) => unknown
  finalizeContent?: (...args: unknown[]) => unknown
  [key: string]: unknown
}

/** One enhanced hunk: the core's shape plus the file-anchored start lines. */
interface EnhancedDiff {
  path: string
  oldText: string | null
  newText: string
  oldStart?: number
  newStart?: number
}

/** Recompute write/edit hunks with the core's exact `structuredPatch` recipe
 *  (context 3, `\` no-newline markers skipped), stamping each hunk's
 *  `oldStart`/`newStart` — the file positions `hunk.oldStart`/`hunk.newStart`
 *  already carry and the core currently discards. Inputs are the tool value's
 *  own `before`/`after` (edit always strings; write's create has `before:
 *  null`, which the core's own write presenter answers with an empty diff
 *  list so the client falls back to the whole-file create). */
function hunksWithLineNumbers(path: string, before: string | null, after: string): EnhancedDiff[] {
  if (before === null) return []
  const patch = structuredPatch('', '', before, after, undefined, undefined, { context: 3 })
  const diffs: EnhancedDiff[] = []
  for (const hunk of patch.hunks) {
    const oldLines: string[] = []
    const newLines: string[] = []
    for (const line of hunk.lines) {
      // The unified-diff marker for a missing trailing newline annotates the
      // patch, not the content — skip it so it never leaks into a diff block.
      if (line.startsWith('\\')) continue
      const text = line.slice(1)
      if (line.startsWith('-')) {
        oldLines.push(text)
      } else if (line.startsWith('+')) {
        newLines.push(text)
      } else {
        // A context (unchanged) line appears on both sides.
        oldLines.push(text)
        newLines.push(text)
      }
    }
    diffs.push({
      path,
      oldText: oldLines.length > 0 ? oldLines.join('\n') : null,
      newText: newLines.join('\n'),
      ...(oldLines.length > 0 ? { oldStart: hunk.oldStart } : {}),
      ...(newLines.length > 0 ? { newStart: hunk.newStart } : {}),
    })
  }
  return diffs
}

/** Shadow-clone a write/edit definition: identical behavior, but the meta
 *  diffs carry each hunk's file-anchored start lines. The shadow keeps the
 *  original's schema/render/execute/presenters and replaces only the
 *  presentation-meta projector. */
function enhanceTool(original: ToolDefinitionLike): ToolDefinitionLike {
  // The original definition's `execute` is a closure over the tool-fs plugin's
  // own ctx/fs/sandbox, so delegating keeps file semantics byte-identical.
  return {
    ...original,
    output: {
      ...(original.output as object),
      // `render` and the presenters are plain methods on the original
      // definition; the meta projector is the ONE behavior this plugin owns.
      presentationMeta(args: unknown, value: unknown): unknown {
        const v = value as { path?: unknown; before?: string | null; after?: unknown }
        const path = typeof v.path === 'string' ? v.path : ''
        const after = typeof v.after === 'string' ? v.after : ''
        const before = typeof v.before === 'string' || v.before === null ? v.before : ''
        return { diffs: hunksWithLineNumbers(path, before, after) }
      },
    },
  }
}

/** Host entry: shadow-register line-number-carrying edit/write into every
 *  agent composed after this plugin loads (the schedule-plugin pattern:
 *  `agent/created` → an effect owned by the exact `agent.ctx`, so the shadow
 *  unregisters when the agent's scope tears down). Agents that existed before
 *  this plugin loaded never get the shadow — the same documented edge as
 *  Schedule. */
export function apply(ctx: PluginContext): void {
  ctx.effect(() => {
    const stop = ctx.on('agent/created', ({ agent }) => {
      void agent.ctx.effect(() => {
        const disposers: Array<() => void> = []
        for (const name of ['edit', 'write']) {
          // The agent-scoped view: the agent OBJECT is the scope key, so the
          // lookup sees the preset standing layer (edit/write live on the
          // agent plane, not the global layer). Registration through the same
          // ctx lands in the agent's OWN layer, shadowing that standing tool.
          const original = agent.ctx.tools.get(name, agent as object)
          if (original === undefined) continue
          // Guard against a double-install (plugin reload, or two diff-viewer
          // copies in one composition): re-registering the same name in the
          // same layer is what the registry rejects, so a second effect that
          // finds the FIRST shadow already visible skips instead of throwing.
          const current = agent.ctx.tools.get(name, agent as object)
          if (current !== undefined && current !== original) continue
          disposers.push(agent.ctx.tools.register(enhanceTool(original)))
        }
        return () => { for (const dispose of disposers) dispose() }
      }, 'dsh-diff-viewer.line-numbers')
    })
    return () => { stop() }
  }, 'dsh-diff-viewer.lifecycle')
}