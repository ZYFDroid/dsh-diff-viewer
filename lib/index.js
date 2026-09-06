import { structuredPatch } from "diff";
//#region src/index.ts
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
/** Recompute write/edit hunks with the core's exact `structuredPatch` recipe
*  (context 3, `\` no-newline markers skipped), stamping each hunk's
*  `oldStart`/`newStart` — the file positions `hunk.oldStart`/`hunk.newStart`
*  already carry and the core currently discards. Inputs are the tool value's
*  own `before`/`after` (edit always strings; write's create has `before:
*  null`, which the core's own write presenter answers with an empty diff
*  list so the client falls back to the whole-file create). */
function hunksWithLineNumbers(path, before, after) {
	if (before === null) return [];
	const patch = structuredPatch("", "", before, after, void 0, void 0, { context: 3 });
	const diffs = [];
	for (const hunk of patch.hunks) {
		const oldLines = [];
		const newLines = [];
		for (const line of hunk.lines) {
			if (line.startsWith("\\")) continue;
			const text = line.slice(1);
			if (line.startsWith("-")) oldLines.push(text);
			else if (line.startsWith("+")) newLines.push(text);
			else {
				oldLines.push(text);
				newLines.push(text);
			}
		}
		diffs.push({
			path,
			oldText: oldLines.length > 0 ? oldLines.join("\n") : null,
			newText: newLines.join("\n"),
			...oldLines.length > 0 ? { oldStart: hunk.oldStart } : {},
			...newLines.length > 0 ? { newStart: hunk.newStart } : {}
		});
	}
	return diffs;
}
/** Shadow-clone a write/edit definition: identical behavior, but the meta
*  diffs carry each hunk's file-anchored start lines. The shadow keeps the
*  original's schema/render/execute/presenters and replaces only the
*  presentation-meta projector. */
function enhanceTool(original) {
	return {
		...original,
		output: {
			...original.output,
			presentationMeta(args, value) {
				const v = value;
				const path = typeof v.path === "string" ? v.path : "";
				const after = typeof v.after === "string" ? v.after : "";
				return { diffs: hunksWithLineNumbers(path, typeof v.before === "string" || v.before === null ? v.before : "", after) };
			}
		}
	};
}
/** Host entry: shadow-register line-number-carrying edit/write into every
*  agent composed after this plugin loads (the schedule-plugin pattern:
*  `agent/created` → an effect owned by the exact `agent.ctx`, so the shadow
*  unregisters when the agent's scope tears down). Agents that existed before
*  this plugin loaded never get the shadow — the same documented edge as
*  Schedule. */
function apply(ctx) {
	ctx.effect(() => {
		const stop = ctx.on("agent/created", ({ agent }) => {
			agent.ctx.effect(() => {
				const disposers = [];
				for (const name of ["edit", "write"]) {
					const original = agent.ctx.tools.get(name, agent);
					if (original === void 0) continue;
					const current = agent.ctx.tools.get(name, agent);
					if (current !== void 0 && current !== original) continue;
					disposers.push(agent.ctx.tools.register(enhanceTool(original)));
				}
				return () => {
					for (const dispose of disposers) dispose();
				};
			}, "dsh-diff-viewer.line-numbers");
		});
		return () => {
			stop();
		};
	}, "dsh-diff-viewer.lifecycle");
}
//#endregion
export { apply };
