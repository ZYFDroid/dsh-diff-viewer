[![dshfind](https://dshfind.com/api/card/lehhair/dsh-diff-viewer?lang=zh)](https://dshfind.com/zh/plugins/lehhair/dsh-diff-viewer?ref=badge)

# dsh-diff-viewer

DSH Web GUI 的 PiUI 风格 diff 查看器插件：替换 write/edit 工具调用的 diff 渲染（原 DiffBlock）。

> 目标版本：**dsh 0.2.1-rc.2**（client 插件的 keyed toolview 契约：`phase` 三阶段 props、**每个阶段都带的 lazy `args` 视图**、框架 `useDisclosure`、注册声明的 `locale` 座位）。

- **统一/并排行号**：unified 单栏默认（同一 gutter 并排显示旧/新行号），split 双栏可选（`viewMode`）
- **真实文件行号**：已完成的 edit/write 顶层调用，行号 gutter 显示**文件中的真实行号**（GitHub 式 `@@` 位置），不是片段内 1..N 重新计数；新建文件（create）显示 1..N
- **变更条**：新增实心绿条、删除条纹红条；行背景色带统一延伸到最宽行
- **词级高亮**：行内改动叠加绿/红标记，shiki 语法着色（`highlightLines`）
- **上下文折叠**：长段未变更行折叠为"`N 行未变更`"，向上/向下/全部展开
- **窗口化渲染**：固定行高窗口化，大 diff 不挂载全部行；sticky 横向滚动条（hover 显现）
- **复制 + `└ +A -R · N file(s)` 页脚**
- **edit 结果默认展开（仅限你正在看的这次调用）**：edit 刚落定时卡片自动展开；重放、刷新或重新展开历史 Turn 时拿到的卡片保持折叠——历史的表现交给 Chat 的「收起时机」设置（回答完成后收起 / 下次发消息时收起）。这条限制同时是性能上的取舍：已折叠 Turn 的行仍然挂在 DOM 里，自动展开它们会把每个 diff 都留在长对话中
- **PTC/Code 嵌套支持**：Code Dispatch 内的 write/edit 子卡片同样接管——嵌套子调用核心短路 meta（`exec.parent` 时不执行 `presentationMeta`），插件按工具参数推导调用时 diff（edit 的 old_string→new_string、write 的整文件新增），错误子调用保持通用错误路径

## 机制

插件通过 **keyed 接管**替换 write/edit 的工具行渲染：ui-tool 的 `tool.call.toolview` 槽是开放 key 域，同一 key 以**更低 priority 阴影**（最低优先渲染）。插件注册 `edit`/`write` 键（priority -1，`locale: 'conversation'` 取官方行的本地化文案），接管后的行**完全复刻官方 FileMutationRow**（复用官方 ToolRow 样式 + DisclosureRow/StateDot 等平台组件，`phase === 'preparing'` 时渲染官方同款不可展开的准备行），只把展开后的 diff 卡换成 PiUI 风格 DiffViewer——**不改任何核心，纯插件**，卸载即还原官方行。

- **三阶段 props**：0.2.1-rc.2 的 toolview owner 显式给出 `phase`（`preparing`/`start`/`result`），**每个阶段都带同一份 lazy `args` 视图**（`has`/`complete`/`text`/`stringLength`，preparing 阶段可能还在增长），所以 `PreparingToolCall` 不再是“没有参数”——准备行能立刻显示已闭合的 `file_path` 和已到达的内容大小（KB）。`start` 另有 `argsRaw`，`result` 是 `ToolResultNode`（`call`/`args`/`name`/`meta`/`isError`）。**0.2.1 移除了旧的 slot 级 `useToolCallArgumentsPartial` hook**，插件不再依赖它。
- **展开状态归框架**：行不再自带 `useState`，改用 owner 注入的 `useDisclosure`（绑定所属 Turn 的重置源）。所以 Chat 的「收起时机」设置直接生效：Turn 折叠时框架把 generation 推进一格，卡片自行收起——本插件**不会**把它重新打开（每行只决定一次）。"落定即默认展开"只在结果事件时间戳距今 60s 内生效，因此重放/刷新出来的历史卡片保持折叠
- **真实行号机制**：核心的 `FileDiff` 契约只有 `{ path, oldText, newText }`，工具执行时 hunk 的真实起始行（`structuredPatch` 的 `oldStart`/`newStart`）被核心丢弃。插件的 host 半（`lib/index.js`）监听 `agent/created`，在每个 agent 自己的 layer 上 re-register 一份 `edit`/`write` **shadow 定义**（官方 schedule 插件同款模式）：schema/render/execute 全部**原样复用原定义**（`...original`），只替换 `output.presentationMeta` 为带行号的版本——用与核心相同的 `structuredPatch`（context 3）复算 hunk，把 `oldStart`/`newStart` 镌进 meta 的 diffs。零额外 diff 计算（同一次 `structuredPatch` 多带两个字段），文件读写语义不变（execute 引用原闭包）。
- **行号透传**：`oldStart`/`newStart` 随 `tool/result` 的 meta 落盘，穿过核心 `diffsFromMeta` 的窄化（只校验三个固定字段、额外字段原样保留）与插件自身的 `narrowDiffs`（畸形值拒绝），到达 DiffViewer 渲染真实行号。
- **无锚点安全降级**：老会话日志（meta 无行号）与 PTC 嵌套子调用（核心在 `exec.parent` 存在时短路 `presentationMeta`，meta 恒缺失）没有锚点 → 行号 gutter 隐藏（回到无行号的 diff 块），绝不显示编造的假行号。create（`oldText: null`）的 newText 即整个新文件，1..N 真实 → 显示。
- **不限制高度**：展开的 diff 直接撑开显示完整内容（不套滚动容器），窗口化渲染保证超大 diff 依然高效
- **diff 数据（dsh 0.2.1-rc.2 契约）**：Host 的 `presentCall`/`presentResult` 视图不再进入 Client，diff 卡完全从**原始事件字段**派生——`preparing` 阶段无 diff（参数还在增长），`start` 阶段用 lazy `args` 推导的调用时 diff（edit 的 old_string→new_string、write 的整文件内容），settled 用 `tool/result` 落盘的 `meta.diffs`（应用后的 hunks，即行号所在的通道）；执行错误走官方行的错误摘要 + IN/OUT 卡
- **卡片路径用调用方的写法**：0.2.1 的 write/edit 结果把 `path` 记成文件系统执行世界的规范绝对路径（`ctx.fs.processPath`），而行的摘要与 `openFile` 用的都是调用自己的 `file_path`；卡片把 hunk 的 path 统一成调用方路径，一张卡不会用两种写法指同一个文件（窗口截断、拿不到参数时保留 meta 里的路径）
- **嵌套兜底**：Code Dispatch 子调用（PTC 模式）的 meta 恒缺失（同上），插件回退到参数的调用时 diff——与官方行渲染同一调用的 running 态一致

## 效果

<img width="1740" height="1048" alt="image" src="https://github.com/user-attachments/assets/67b4db35-07e5-4fce-852d-bbe4ee33b695" />

## 安装

### 方式一：GitHub 仓库直装（源码 + 构建产物）

`lib/` 构建产物**已提交进仓库**，因此 `github:` 直装可直接工作（market 的 Install 按钮即走此路径）：

```sh
dsh plugin --profile web add "github:lehhair/dsh-diff-viewer"
```

> 直装装的是仓库当前 commit 的构建产物。想要跟随最新 commit 请用 Release 资产（见下），它永远指向最新**发版**。

### 方式二：GitHub Release 构建产物（推荐，跟随发版）

每次发版后，GitHub Actions 自动构建并把 tarball 附加到 [Releases](https://github.com/lehhair/dsh-diff-viewer/releases) 页。`releases/latest` 永远指向最新版本，安装链接不需要随版本改动：

```sh
# 直接用 latest 资产 URL（永远是最新版）：
dsh plugin --profile web add "https://github.com/lehhair/dsh-diff-viewer/releases/latest/download/dsh-external-dsh-diff-viewer.tgz"

# 重启 dsh web 生效
dsh web
```

> ⚠️ 升级注意：pnpm 会按 URL 缓存 tarball——同一 `latest` 链接在出新版本后可能命中旧缓存。升级失败/装到旧版时，先 `dsh plugin --profile web remove @dsh-external/dsh-diff-viewer`，再 `pnpm store prune`（或删除 `pnpm store path` 输出目录中的对应缓存）后重新安装。

### 方式三：本地 tarball（离线 / 自测）

不联网、也不依赖 GitHub 时，直接在仓库里打一个 tarball 装进 profile：

```sh
# 打包：清单里的 devDependencies 必须剥掉（它们是 link:../deepseek-harness/...，
# 装到使用者 profile 里会解析失败）；输出 dist/dsh-external-dsh-diff-viewer.tgz
# 安装（裸绝对路径与 file:// 两种写法都走本地 tarball 分支）：
dsh plugin --profile web add "C:/path/to/dsh-diff-viewer/dist/dsh-external-dsh-diff-viewer.tgz"
dsh plugin --profile web add "file:///C:/path/to/dsh-diff-viewer/dist/dsh-external-dsh-diff-viewer.tgz"
```

> ⚠️ 不要用 `npm pack` 打这个包：`link:` 的 devDependencies 会让它顺着链接遍历整个 harness checkout，实测直接堆溢出。按 `files` 字段 staging 后 `tar -czf`（根目录需为 `package/`）即可。
>
> ⚠️ tarball 按路径缓存，改完源码重新打包后要先 `remove` 再 `add`，否则装到的还是旧内容。

### 开发环境（从源码）

```sh
# devDependencies 用 link: 指向 ../deepseek-harness（本地 deepseek-harness checkout，0.2.1-rc.2）
pnpm install && pnpm run check    # typecheck + test + build
# 直接安装本地目录，或 npm pack 后装 tarball：
dsh plugin --profile web add E:\dev\dsh-diff-viewer
```

> Windows 注意：`dsh plugin add <本地目录>` 的 `link:` 绝对路径有 junction bug（pnpm 拼错目标）。用 **tarball**（`npm pack` 后 `dsh plugin add *.tgz`）可绕过。

> 发版注意：`lib/` 已提交，源码改动必须同时重建并提交 `lib/`（CI 的 `check` 后会校验 `lib/` 与源码一致，不一致即失败）。

## 卸载

```sh
dsh plugin --profile web remove @dsh-external/dsh-diff-viewer
```

## 开发

```sh
pnpm install && pnpm run check    # typecheck + test + build
```

测试需要 workspace 内的 `@deepseek-ai/dsh-*` 包（devDependencies 用 `link:` 指向 `../deepseek-harness`，vitest alias 统一 react 单实例；接管行复用 ui-tool 的 `ToolRow.module.css`，经包导出的 src 子路径内联进 bundle）。被测的 harness checkout 需先 `pnpm install`（其 workspace 依赖解析器供给 ui-primitives 等源码的第三方依赖）。

用例构造 block 时要造**真的 lazy `args` 视图**：`PartialArguments`（`@deepseek-ai/dsh-util-values`）是带私有字段的 nominal 类，普通对象顶不了。该包零运行时依赖，所以 `tsconfig.client.json` 的 `paths` 与 `vitest.config.ts` 的 alias 都把它指到 harness 的 `src/index.ts`，不必装进插件。

## 友情链接 / Friend Links

- [DSHFind](https://dshfind.com/) — DeepSeek Harness 插件市场与学习社区

