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
// old `@deepseek-ai/dsh-client-runtime/client` module was removed upstream,
// dsh 0.1.2+, and plugins now type the apply parameter as the plain cordis
// Context and pull each service's Context merge with type-only imports).
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the SlotRegistry Context merge (ctx.slots) — the slots
// service lives in the ui-renderer package (moved out of the removed
// client-runtime).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { MutationRow } from './mutation-row.tsx'

/** Required service: the slot registry. */
export const inject = ['slots']

/** The tool keys this plugin takes over (the wire tools that emit diff cards). */
const MUTATION_TOOLS = ['edit', 'write'] as const

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
        priority: -1,
      }, MutationRow)
    }
  })
}
