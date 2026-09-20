# pi-ctf — 提示词替换扩展

> 从 [pi-session-patcher](../.pi/agent/extensions/pi-session-patcher) fork 独立的 pi 扩展。
> 定位反转：**以「提示词替换」为主要作用**，提示词追加留给「委派」。

## 功能

### 1. 提示词替换 / 追加（CTF·渗透测试工作流提示词）

两种注入模式：

| 模式 | 用途 | 行为 |
| --- | --- | --- |
| **replace（默认，主要作用）** | 主会话强 CTF | 用 CTF/渗透测试工作流提示词**替换** pi 内置默认剧本；**AGENTS.md 与 skill 清单仍保留**（对齐 pi 原生 `--system-prompt` 语义） |
| **append（委派场景）** | 子代理委派 | 在现有系统提示词**末尾追加** CTF 提示词，pi 原生剧本与父上下文完整保留——子代理 fork 父会话时不被破坏已有能力 |

- `/ctf` 菜单可切换两种模式 / 关闭注入；状态与模式按会话持久化，`pi -c` / resume 自动恢复
- CLI 旗标直启（需放在其他参数之前）：`pi --ctfr`（替换）/ `pi --ctfa`（追加）
- 开启时页脚状态条显示 `CTF` 标识
- 内置三层 CTF 工作流模板：侦察 → 漏洞证明 → 利用 → 取旗 → 复现，覆盖 Web / Pwn / RE / 密码 / 取证 / 移动 / 云容器 AD 各域

### 2. 实时拒绝拦截（会话清理 · 事前版）

- 助手消息定稿时检测拒绝回复：两级检测（强短语全文 + 弱关键词开头 150 字符 + 自定义关键词）
- 命中即把消息文本替换为配合性兜底文本——拒绝内容不落盘，不污染后续 resume
- 每次拦截都会通知；`/ctf` 菜单「拦截器」项可随时开关

## 安装

```bash
# 方式一：复制到 pi 全局扩展目录（自动发现，支持 /reload 热重载）
cp -r ~/Desktop/TestCC/pi-ctf ~/.pi/agent/extensions/pi-ctf

# 方式二（开发调试，不安装）：pi --ctfr -e ~/Desktop/TestCC/pi-ctf/index.ts …
```

## 使用

输入 **`/ctf`** 回车，弹出交互式菜单：

```text
┌ CTF 模式
│ > 替换模式   ← 当前
│  追加模式
│  关闭注入
│  拦截器：开启
│  查看状态
└
```

- 菜单项实时标注当前状态（`← 当前`）；默认**替换模式**（主要作用）
- **追加模式**留给委派子代理场景：子代理需要完整原生剧本 + CTF 提示词时选用
- 选替换模式会提示：将替换 pi 内置默认剧本（AGENTS.md 与 skill 清单仍保留）

### CLI 启动旗标（旗标需放在其他旗标之前）

| 旗标 | 说明 |
| --- | --- |
| `pi --ctfr` | 以 CTF **替换模式**启动（默认，主要作用） |
| `pi --ctfa` | 以 CTF **追加模式**启动（委派场景） |
| `pi --ctf` | 同 `--ctfa`（历史别名） |
| `pi --ctf-mode replace|append` | 显式指定注入模式 |

> 注：脚本/print 模式下无菜单，请用上述旗标；实时拒绝拦截默认开启，可在菜单中切换。

## 可选：与 codex-session-patcher 联动

本机存在 `~/.codex-patcher/config.json` 时自动读取（上游主工具不装则使用内置默认）：

| 字段 | 作用 |
| --- | --- |
| `mock_response` | 拦截后的兜底替换文本（问号乱码自动忽略） |
| `custom_keywords` | 自定义拒绝检测关键词（各语言合并，全文匹配） |
| `ctf_prompts.pi.prompt` | 自定义 CTF 提示词模板（覆盖内置模板） |

## 开发

```bash
pnpm install        # 安装 devDeps（typescript / @types/node / pi 类型）
pnpm typecheck      # tsc --noEmit
pnpm test           # node --experimental-strip-types 直接运行单元测试（17 项断言）
```

源码结构：

```text
pi-ctf/
├── index.ts              # 入口：/ctf 菜单、--ctf/--ctfa/--ctfr 旗标、替换/追加注入、拒绝拦截、状态持久化
├── tsconfig.json
├── src/detector.ts       # 两级拒绝检测器 + 文本提取/替换
├── src/prompts.ts        # 兜底文本 + 加载 pi_ctf_prompt.md + 问号乱码检测 + 注入标记
├── src/pi_ctf_prompt.md  # 默认 CTF 提示词（三层工作流版；所有权标记 pi-ctf:prompt-replace）
├── src/config.ts         # 可选读取 ~/.codex-patcher/config.json
└── test/detector.test.ts # 单元测试
```

### E2E 验证（探针检查注入是否生效）

```bash
mkdir -p /tmp/ctf-verify
# 替换模式：pi --ctfr -ne -p -e /tmp/ctf-verify/probe.ts -e index.ts "Reply with exactly: ok"
# 期望：{ ctfInjected: true, defaultPromptPresent: false, agentsMdPresent: true }
# 追加模式：pi --ctfa … 期望 defaultPromptPresent: true（原生剧本保留）
```

## 与上游 pi-session-patcher 的差异

| 维度 | pi-session-patcher | pi-ctf（本扩展） |
| --- | --- | --- |
| 默认模式 | append（追加） | **replace（替换）** |
| 定位 | CTF 注入 + 拦截 | **提示词替换为主**；追加留给委派 |
| 注入标记 | `codex-session-patcher:pi-ctf` | `pi-ctf:prompt-replace` |
| 启动旗标 | `--ctf / --ctfa / --ctfr` | `--ctfr`（替换，默认）/ `--ctfa`（追加） |

## 局限

- 实时拦截只保护本会话新产生的消息；历史会话批量清理请用上游 codex-session-patcher Web UI
- 拦截基于文本特征匹配，存在理论误报；每次拦截都会通知，可关闭
- 无法突破平台最高安全策略，效果因模型版本而异
