/**
 * The taken-over mutation row: a faithful re-implementation of the stock
 * ui-tool FileMutationRow (which composes ToolRow), reusing the STOCK row's
 * own stylesheet and the platform DisclosureRow/StateDot/icon components, so
 * the row looks and behaves exactly like the shipped one — only the expanded
 * diff card renders through this plugin's DiffViewer instead of DiffBlock.
 *
 * dsh 0.2.0-rc.2 contract: the keyed `tool.call.toolview` owner supplies one
 * explicit phase (`preparing` | `start` | `result`), the framework's
 * `useDisclosure` hook (bound to the enclosing Turn's reset source, so a row
 * hidden by its Turn comes back collapsed), the business-face hook
 * `useToolCallArgumentsPartial` for the preparing phase, and the localized `t`
 * seat declared by this plugin's registration (`locale: 'conversation'`). The
 * row model derivation (title/summary/path/output/error/state) mirrors the
 * stock tool-call model for the edit/write variants; the CSS classes come from
 * the ui-tool package's exported src subpath (inlined into this bundle).
 *
 * `MutationRow` is the registered component; the two phase components below it
 * take only the inputs they read, so a spec can render the row without
 * standing up the framework's session seats.
 */
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  DisclosureRow, IconEditOutlineRegular, IconInspectOutlineRegular, StateDot, TextShimmer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  OpenFileOptions, StartedToolCall, ToolResultNode, UseDisclosure,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
// The stock row's stylesheet, imported through the package's exported src
// subpath and inlined — the takeover row renders with the exact stock chrome.
import rowCss from '@deepseek-ai/dsh-client-ui-tool/src/client/tool/components/ToolRow.module.css'
import { DiffViewer } from './DiffViewer.tsx'
import { diffCardModel } from './diffcard-contract.ts'

/** Row state semantic; colors self-supplied via StateDot. */
type MutationRowState = 'running' | 'ok' | 'error' | 'stopped'
/** Row variant for the mutation tools this plugin owns. */
type MutationRowVariant = 'write' | 'edit'
/** A mutation call that has left the preparing phase. */
type DispatchedBlock = StartedToolCall | ToolResultNode
/** The conversation translate seat this row's copy goes through. */
type Translate = TranslateNS<'conversation'>

/** Full props of the registered takeover row: the keyed toolview owner
 *  currency plus the locale seat this plugin's registration declares. */
export type MutationRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/** Inputs of the dispatched/settled row (the seats it actually reads). */
export interface StartedRowProps {
  toolName: string
  block: DispatchedBlock
  cwd?: string | undefined
  openFile: (path: string, options?: OpenFileOptions) => void
  inspect?: (() => void) | undefined
  useDisclosure: UseDisclosure
  t: Translate
}

/** Inputs of the preparing row (the seats it actually reads). */
export interface PreparingRowProps {
  toolName: string
  useDisclosure: UseDisclosure
  useToolCallArgumentsPartial: () => string
  t: Translate
}

/** The row's shared icon (stock FileMutationRow chrome). */
const MUTATION_ICON = <IconEditOutlineRegular size={14} />

/** Flatten a settled result's content blocks to display text (stock resultText). */
function resultText(node: ToolResultNode): string {
  const parts: string[] = []
  for (const block of node.content) {
    if (block.type === 'text') parts.push(block.text)
    else parts.push(JSON.stringify(block, null, 2))
  }
  if (parts.length === 0 && node.error !== undefined) {
    parts.push(`${node.error.name}: ${node.error.code}`)
  }
  return parts.join('\n')
}

function firstLine(text: string): string {
  const nl = text.indexOf('\n')
  return nl === -1 ? text : text.slice(0, nl)
}

function parseArgs(argsRaw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** Row variant per wire Tool name (the two keys this plugin takes over). */
function variantOf(toolName: string): MutationRowVariant {
  return toolName === 'edit' ? 'edit' : 'write'
}

/** The stock row's title key per wire Tool name. */
function titleKeyOf(toolName: string): 'tool.title.edit' | 'tool.title.write' {
  return toolName === 'edit' ? 'tool.title.edit' : 'tool.title.write'
}

/** Derive the row model for the edit/write variants (stock toolRowModel
 *  mirror; the stock model additionally abbreviates a POSIX-home-rooted
 *  summary to `~`, which this mirror skips — the plugin never receives `home`
 *  from the slot owner it registers for). */
function rowModel(toolName: string, block: DispatchedBlock, cwd?: string): {
  variant: MutationRowVariant
  summary: string
  filePath: string | undefined
  body: string | null
  output: string | null
  errorSummary: string | null
  state: MutationRowState
} {
  const variant = variantOf(toolName)
  const settled = 'kind' in block
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const state: MutationRowState = !settled ? 'running'
    : block.error?.code === 'interrupted' ? 'stopped'
      : block.isError ? 'error' : 'ok'
  const parsed = parseArgs(argsRaw)
  const path = parsed !== undefined
    ? (typeof parsed['file_path'] === 'string' && parsed['file_path'] !== '' ? parsed['file_path']
      : typeof parsed['path'] === 'string' ? parsed['path'] : undefined)
    : undefined
  // Workspace-rooted paths display relative to the session cwd (stock rule).
  const rel = (text: string): string => {
    if (cwd === undefined || cwd === '') return text
    const root = cwd.replace(/[/\\]+$/, '')
    if (text.startsWith(`${root}/`) || text.startsWith(`${root}\\`)) return text.slice(root.length + 1)
    return text
  }
  const summary = path !== undefined ? rel(path) : firstLine(argsRaw === '' ? block.callId : argsRaw)
  const output = settled ? (resultText(block) || null) : null
  return {
    variant,
    summary,
    filePath: path,
    body: argsRaw === '' ? null : (parsed !== undefined ? JSON.stringify(parsed, null, 2) : argsRaw),
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
    state,
  }
}

/** Leading-slot state substitution (stock): icon yields to the state semantic. */
function leadingFor(state: MutationRowState, icon: ReactNode): ReactNode {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    default: return icon
  }
}

/** Visually hidden run-state label (stock AT requirement). */
function stateStatus(state: MutationRowState, t: Translate): string | null {
  switch (state) {
    case 'running': return t('row.running')
    case 'error': return t('row.failed')
    case 'stopped': return t('row.stopped')
    default: return null
  }
}

/**
 * Whether a row card opens by default: a settled, successful `edit` result
 * shows its replacement diff without a click — the issue-driven default
 * (「edit 的结果卡片默认展开」). Writes keep the stock collapsed default (a
 * whole-file diff is bulk), and running or errored rows stay collapsed so the
 * flow never auto-expands transient or error-only cards. Pure for direct
 * testing.
 * @param toolName - the wire Tool name.
 * @param block - the frozen dispatched or settled call slice.
 * @returns whether the row's expanded body should start open.
 */
export function defaultOpenFor(toolName: string, block: DispatchedBlock): boolean {
  return toolName === 'edit' && 'kind' in block && !block.isError
}

/**
 * The registered mutation toolview: one explicit phase per dispatch, exactly
 * like the stock FileMutationRow (a preparing call has no dispatchable body).
 * @param props - keyed toolview owner currency plus the locale seat.
 * @returns the preparing or dispatched row.
 */
export function MutationRow(props: MutationRowProps) {
  return props.phase === 'preparing'
    ? (
      <PreparingMutationRow
        toolName={props.toolName}
        useDisclosure={props.useDisclosure}
        useToolCallArgumentsPartial={props.useToolCallArgumentsPartial}
        t={props.t}
      />
    )
    : (
      <StartedMutationRow
        toolName={props.toolName}
        block={props.block}
        cwd={props.cwd}
        openFile={props.openFile}
        inspect={props.inspect}
        useDisclosure={props.useDisclosure}
        t={props.t}
      />
    )
}

/**
 * The preparing prefix: stock PreparingToolRow chrome — a named call whose
 * arguments have not arrived, with the streamed argument prefix summarized by
 * size and no disclosure (there is nothing to expand yet).
 * @param props - preparing-phase row inputs.
 * @returns the non-expandable preparing row.
 */
export function PreparingMutationRow({ toolName, useDisclosure, useToolCallArgumentsPartial, t }: PreparingRowProps) {
  const raw = useToolCallArgumentsPartial()
  const { expanded, toggle } = useDisclosure()
  const summary = t('tool.preparing.content', { kilobytes: Math.ceil(raw.length / 1024) })
  return (
    <div className={rowCss.root} data-variant={variantOf(toolName)} data-tool={toolName}
      data-state="preparing" data-diff-viewer-row="">
      <span className={rowCss.visuallyHidden}>{t('row.preparing')}</span>
      <DisclosureRow
        rowClassName={rowCss.row}
        leadingClassName={rowCss.leading}
        titleClassName={rowCss.title}
        icon={MUTATION_ICON}
        title={t(titleKeyOf(toolName))}
        running
        open={expanded}
        expandable={false}
        onToggle={toggle}
        collapsedContent={(
          <>
            <span className={rowCss.sep} aria-hidden />
            <span className={rowCss.summary}><TextShimmer>{summary}</TextShimmer></span>
          </>
        )}
      />
    </div>
  )
}

/**
 * The dispatched/settled row: stock FileMutationRow chrome (DisclosureRow,
 * state dot, path link, error summary, IN/OUT card) with the expanded diff
 * card rendered through DiffViewer.
 * @param props - dispatched/settled row inputs.
 * @returns the disclosure row.
 */
export function StartedMutationRow({
  toolName, block, cwd, openFile, inspect, useDisclosure, t,
}: StartedRowProps) {
  const { expanded, setExpanded, toggle } = useDisclosure()
  // A live session mounts the row while its call is still running (collapsed)
  // and settles it in place, so the default-open rule fires both when the row
  // first appears already settled (replayed history) and once on the
  // running→settled transition; a manually toggled row keeps its state until
  // the enclosing Turn hides it (the hook's own reset).
  const wasSettled = useRef(false)
  useEffect(() => {
    const settled = 'kind' in block
    if (settled && !wasSettled.current && defaultOpenFor(toolName, block)) setExpanded(true)
    wasSettled.current = settled
  }, [toolName, block, setExpanded])
  const model = rowModel(toolName, block, cwd)
  const diffBody = diffCardModel(block)
  const outputText = model.output
  const expandable = model.body !== null || outputText !== null || diffBody !== null
  const open = expanded && expandable
  const status = stateStatus(model.state, t)
  const failureLine = model.state === 'error' ? model.errorSummary ?? null : null
  const summaryText = failureLine ?? model.summary
  const fileLink = model.filePath !== undefined && failureLine === null
  const openFilePath = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (model.filePath !== undefined) openFile(model.filePath)
  }
  const fileLinkKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
  }
  return (
    <div className={rowCss.root} data-variant={model.variant} data-tool={toolName}
      data-state={model.state} data-diff-viewer-row="">
      {status !== null && <span className={rowCss.visuallyHidden}>{status}</span>}
      <DisclosureRow
        rowClassName={rowCss.row}
        leadingClassName={rowCss.leading}
        titleClassName={rowCss.title}
        icon={leadingFor(model.state, MUTATION_ICON)}
        title={t(titleKeyOf(toolName))}
        running={model.state === 'running'}
        open={open}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={toggle}
        collapsedContent={summaryText !== '' && (
          <>
            <span className={rowCss.sep} aria-hidden />
            {fileLink ? (
              <button type="button" className={rowCss.fileLink} onClick={openFilePath} onKeyDown={fileLinkKeyDown}>
                <TextShimmer>{summaryText}</TextShimmer>
              </button>
            ) : (
              <span className={clsx(rowCss.summary, failureLine !== null && rowCss.errorSummary)}>
                <TextShimmer>{summaryText}</TextShimmer>
              </span>
            )}
          </>
        )}
      >
        <div className={rowCss.bodyWrap}>
          {diffBody !== null
            // No height cap: the diff card grows to its full content (the
            // windowed renderer still handles very large diffs efficiently).
            ? <DiffViewer diffs={diffBody.card.diffs} className={rowCss.diffBody} />
            : (
              <>
                {(model.body !== null || outputText !== null) && (
                  <div className={rowCss.ioCard}>
                    {model.body !== null && (
                      <div className={rowCss.ioSection}>
                        <span className={rowCss.ioLabel}>{t('row.input')}</span>
                        <span className={rowCss.ioText}>{model.body}</span>
                      </div>
                    )}
                    {model.body !== null && outputText !== null && (
                      <span className={rowCss.ioDivider} aria-hidden />
                    )}
                    {outputText !== null && (
                      <div className={rowCss.ioSection}>
                        <span className={rowCss.ioLabel}>{t('row.output')}</span>
                        <span className={rowCss.ioText} data-error={model.state === 'error' || undefined}>
                          {outputText}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          {inspect !== undefined && (
            <button type="button" className={rowCss.inspectButton} onClick={inspect}>
              <IconInspectOutlineRegular />
              {t('row.inspect')}
            </button>
          )}
        </div>
      </DisclosureRow>
    </div>
  )
}
