//#region src/index.d.ts
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
/** The context surface this host half touches (cordis Context plus the tools
 *  and scope integration the core merges in; declared minimally so the plugin
 *  stays free of any core package import). */
interface PluginContext {
  on(event: 'agent/created', listener: (payload: {
    agent: AgentLike;
  }) => void): () => void;
  effect(callback: () => () => void, label?: string): () => void;
}
/** An agent as `agent/created` hands it: the scope key that owns the ctx. */
interface AgentLike {
  ctx: AgentContext;
}
/** The scoped context whose own layer shadows the preset standing layer. */
interface AgentContext {
  tools: ToolsService;
  effect(callback: () => () => void, label?: string): () => void;
}
/** The tool registry face this plugin uses. */
interface ToolsService {
  /** Resolve the definition visible to THIS scope (agent-layer-aware view). */
  get(name: string, scope?: object): ToolDefinitionLike | undefined;
  /** Register into the CALLING context's layer (agent.ctx → agent's own layer). */
  register(definition: ToolDefinitionLike): () => void;
}
/** The fraction of a registered tool this wrapper clones. */
interface ToolDefinitionLike {
  name: string;
  output: {
    schema?: unknown;
    render?: (...args: unknown[]) => unknown;
    presentationMeta?: (args: unknown, value: unknown) => unknown;
  };
  execute?: (...args: unknown[]) => Promise<unknown>;
  presentCall?: (...args: unknown[]) => unknown;
  presentResult?: (...args: unknown[]) => unknown;
  finalizeContent?: (...args: unknown[]) => unknown;
  [key: string]: unknown;
}
/** Host entry: shadow-register line-number-carrying edit/write into every
 *  agent composed after this plugin loads (the schedule-plugin pattern:
 *  `agent/created` → an effect owned by the exact `agent.ctx`, so the shadow
 *  unregisters when the agent's scope tears down). Agents that existed before
 *  this plugin loaded never get the shadow — the same documented edge as
 *  Schedule. */
declare function apply(ctx: PluginContext): void;
//#endregion
export { apply };