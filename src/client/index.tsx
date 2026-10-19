/**
 * Registers the DiffViewer surface into the ui-tool keyed atomic Tool view
 * slot (`tool.call.toolview`) under the write/edit keys. The keyed slot
 * lets a registration at a LOWER priority shadow a shipped key (lowest
 * priority renders), so this plugin's rows take over the stock
 * FileMutationRow while mounted and return automatically on unload.
 *
 * The takeover row re-implements the stock FileMutationRow chrome faithfully
 * (the stock ToolRow stylesheet + platform DisclosureRow/StateDot/icons) —
 * only the expanded diff card renders through the PiUI-style DiffViewer.
 */

// The client context type: cordis' Context merged with the plugin surfaces
// referenced below (ui-renderer's ctx.slots via the type-only import; the
// removed `@deepseek-ai/dsh-client-runtime/client` package has no successor —
// plugins type the apply parameter as the plain cordis Context and pull each
// service's Context merge with type-only imports).
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the SlotRegistry Context merge (ctx.slots) with the current
// `tool.call.toolview` SlotMap declaration (owner phase props, slot-level
// inject hooks) — the slots service lives in ui-renderer, the Tool slot
// contract in ui-tool.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { MutationRow } from './mutation-row.tsx'

/** Required service: the slot registry. */
export const inject = ['slots']

/** The tool keys this plugin takes over (the wire tools that emit diff cards). */
const MUTATION_TOOLS = ['edit', 'write'] as const

/**
 * Dictionary namespace the takeover row's copy is translated through; the
 * stock FileMutationRow registers under the same one, so titles, states, and
 * the IN/OUT/inspect chrome follow the active locale exactly as the row it
 * replaces does.
 */
const NS = 'conversation'

/**
 * Mount the DiffViewer rows into the keyed atomic Tool view slot under the
 * mutation tool keys, shadowing the shipped rows at a lower priority.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const key of MUTATION_TOOLS) {
      yield ctx.slots.register({
        name: 'tool.call.toolview',
        key,
        locale: NS,
        priority: -1,
      }, MutationRow)
    }
  })
}
