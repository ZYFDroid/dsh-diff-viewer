import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** DSH fork sources: the plugin builds on the fork's primitives (highlight,
    copy feedback), and the linked packages' `./client` exports point at
    browser bundles (lib/client.js, loader-bannered) — tests must resolve to
    the fork's src instead, like the monorepo's tsconfig paths. */
const fork = fileURLToPath(new URL('../deepseek-harness/packages/client', import.meta.url))

/** React must be ONE instance: the fork's primitives (linked via the monorepo)
    call react hooks that DiffViewer invokes, and two React copies break the
    hook dispatcher. The production bundle keeps react external (a platform
    module), so this is a test-only concern. Array form with the longer
    subpath keys first (object-form aliases prefix-match, so a bare `react`
    key would swallow the jsx-runtime subpaths). */
const require = createRequire(import.meta.url)

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    environment: 'node',
    pool: 'threads',
  },
  resolve: {
    alias: [
      { find: 'react/jsx-dev-runtime', replacement: require.resolve('react/jsx-dev-runtime') },
      { find: 'react/jsx-runtime', replacement: require.resolve('react/jsx-runtime') },
      { find: 'react-dom', replacement: require.resolve('react-dom') },
      { find: 'react', replacement: require.resolve('react') },
      // The src/ prefix must precede the bare package name (string finds
      // prefix-match) so tests can import fork internals like clipboard.ts.
      { find: '@deepseek-ai/dsh-client-ui-primitives/src/', replacement: `${fork}/ui-primitives/src/` },
      // dsh 0.2.0-rc.2: the block types live in ui-chat, the slots service in
      // ui-renderer, and the Tool slot contract in ui-tool. Tests must resolve
      // those src roots (and the cordis vendor package, whose bare specifier
      // moved to @deepseek-ai/cordis).
      { find: '@deepseek-ai/dsh-client-ui-chat/client', replacement: `${fork}/ui-chat/src/client/index.ts` },
      { find: '@deepseek-ai/dsh-client-ui-renderer/client', replacement: `${fork}/ui-renderer/src/client/index.ts` },
      { find: '@deepseek-ai/dsh-client-ui-slots', replacement: `${fork}/ui-slots/src/index.ts` },
      { find: '@deepseek-ai/dsh-client-ui-primitives', replacement: `${fork}/ui-primitives/src/index.ts` },
      { find: '@deepseek-ai/dsh-client-ui-tool/client', replacement: `${fork}/ui-tool/src/client/index.ts` },
      { find: '@deepseek-ai/dsh-client-ui-conversation/client', replacement: `${fork}/ui-conversation/src/client/index.ts` },
      { find: '@deepseek-ai/dsh-client-ui-layout/client', replacement: `${fork}/ui-layout/src/client/index.ts` },
      { find: '@deepseek-ai/dsh-client-locale/client', replacement: `${fork}/locale/src/client/index.ts` },
      // Source-internal workspace edges of the packages aliased above: their
      // published `exports` resolve to built lib/, which a plugin-only dev
      // checkout does not necessarily have — the monorepo's own vitest run
      // resolves these through tsconfig paths to the same src entries.
      { find: '@deepseek-ai/dsh-client-store', replacement: `${fork}/store/src/index.ts` },
      { find: '@deepseek-ai/dsh-util-workspace-path', replacement: `${fork}/../util/workspace-path/src/index.ts` },
      { find: '@deepseek-ai/dsh-util-code-language', replacement: `${fork}/../util/code-language/src/index.ts` },
      // dsh 0.2.1-rc.2: tool blocks carry the lazy argument view, whose class
      // (`PartialArguments`) is nominal — specs must build the real one, so the
      // zero-dependency utility package resolves to its src for tests.
      { find: '@deepseek-ai/dsh-util-values', replacement: `${fork}/../util/values/src/index.ts` },
      { find: '@deepseek-ai/dsh-client-test-runtime', replacement: `${fork}/../test-support/client-runtime/src/index.ts` },
      { find: '@deepseek-ai/dsh-client-test-runtime/client', replacement: `${fork}/../test-support/client-runtime/src/client/index.ts` },
    ],
  },
})


