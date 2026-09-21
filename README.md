# pi-roles — 角色模板系统

> 从 [pi-session-patcher](../.pi/agent/extensions/pi-session-patcher) fork 独立的 pi 扩展。
> 以「角色」为单位管理提示词模板：**一个角色 = `roles/<name>.md` 一个文件，放目录即自动出现，添加角色零代码**。

## 功能

### 1. 角色模板系统

| 模式 | 用途 | 行为 |
| --- | --- | --- |
| **replace（默认）** | 主会话换角色 | 用角色模板**替换** pi 内置默认剧本；**AGENTS.md 与 skill 清单仍保留**（对齐 pi 原生 `--system-prompt` 语义） |
| **append（委派场景）** | 子代理委派 | 在现有系统提示词**末尾追加**角色模板，原生剧本与父上下文完整保留——子代理 fork 父会话时带角色上场 |

- `/role` 菜单动态列出全部角色（含描述）；`/role <name>` 直切；`/role <name> append|replace` 指定模式
- 状态与模式按会话持久化，`pi -c` / resume 自动恢复；状态条显示当前角色（如 `R:ctf`）
- 内置角色：`ctf`（CTF/渗透测试三层工作流：侦察 → 漏洞证明 → 利用 → 取旗 → 复现）
- **自定义角色**：`~/.pi/agent/roles/<name>.md`（同名覆盖内置）

### 2. 实时拒绝拦截（随角色模式联动）

- **只有开启角色注入时才自动生效**，其他模式一律不拦截（本次迭代修复：拦截不再默认全局开启）
- 助手消息定稿时检测拒绝回复（强短语全文 + 弱关键词开头 150 字符 + 自定义关键词），命中即替换为配合性兜底文本，拒绝内容不落盘
- 每次拦截都会通知；`/role` 菜单「拦截器」项可随时开关（角色模式下）

## 安装

```bash
# 方式一：从 git 安装（推荐，后续迭代通过 git 更新）
pi install git:github.com/tutu359/pi-roles

# 方式二：复制到全局扩展目录
cp -r ~/Desktop/TestCC/pi-roles ~/.pi/agent/extensions/pi-roles

# 方式三（开发调试，不安装）：pi --role ctf -e ~/Desktop/TestCC/pi-roles/index.ts …
```

## 使用

### 命令

```text
/role                    交互式菜单（列出全部角色 + 关闭注入 + 拦截器 + 状态）
/role ctf                直切角色（保持当前模式）
/role ctf append         指定角色 + 追加模式（委派子代理场景）
/role ctf replace        指定角色 + 替换模式（主会话）
/ctf                     /role 的别名（兼容旧习惯）
```

### CLI 旗标（需放在其他旗标之前）

| 旗标 | 说明 |
| --- | --- |
| `pi --role <name>` | 指定角色 + 替换模式（默认），如 `--role ctf` |
| `pi --role-append <name>` | 指定角色 + 追加模式（委派），如 `--role-append ctf` |
| `pi --role-mode replace\|append` | 模式覆盖 |
| `pi --ctfr` | 快捷：ctf 角色 + 替换模式 |
| `pi --ctfa` / `--ctf` | 快捷：ctf 角色 + 追加模式 |
| `pi --ctf-mode replace\|append` | `--role-mode` 的旧名（兼容） |

## 添加新角色（零代码）

在 `roles/`（内置）或 `~/.pi/agent/roles/`（用户级，同名覆盖内置）放一个 `<name>.md`：

```markdown
<!-- managed-by: pi-roles:<name> -->
<!-- role-desc: <一句话用途，显示在 /role 菜单> -->
<角色人设 + 行为规则 + 输出契约>
```

保存后立即出现在 `/role` 菜单，`/role <name>` 即可启用。

## 可选：与 codex-session-patcher 联动

本机存在 `~/.codex-patcher/config.json` 时自动读取（不装则使用内置默认）：

| 字段 | 作用 |
| --- | --- |
| `mock_response` | 拦截后的兜底替换文本（问号乱码自动忽略） |
| `custom_keywords` | 自定义拒绝检测关键词（各语言合并，全文匹配） |
| `ctf_prompts.pi.prompt` | 覆盖 ctf 角色的模板 |

## 开发

```bash
pnpm install        # 安装 devDeps（typescript / @types/node / pi 类型）
pnpm typecheck      # tsc --noEmit
pnpm test           # node --experimental-strip-types 直接运行单元测试（17 项断言）
```

源码结构：

```text
pi-roles/
├── index.ts              # 入口：/role 命令、--role/--ctf* 旗标、角色注入、拦截（联动）、状态持久化
├── roles/                # ⭐ 角色模板目录（放 .md = 一个角色）
│   └── ctf.md            # CTF 角色（标记 pi-roles:ctf）
├── src/
│   ├── prompts.ts        # 角色加载/发现（内置 + ~/.pi/agent/roles/）+ 兜底文本 + 乱码检测
│   ├── detector.ts       # 两级拒绝检测器 + 文本提取/替换
│   └── config.ts         # 可选读取 ~/.codex-patcher/config.json
└── test/detector.test.ts # 单元测试
```

### E2E 验证

```bash
mkdir -p /tmp/ctf-verify
# 替换模式：pi --ctfr -ne -p -e /tmp/ctf-verify/probe.ts -e index.ts "Reply with exactly: ok"
#   期望：{ ctfInjected: true, defaultPromptPresent: false, agentsMdPresent: true }
# 追加模式：pi --role-append ctf … 期望 defaultPromptPresent: true（原生剧本保留）
# 拦截联动：
#   无角色 → 拒绝回复原样输出；--ctfr 开启 → 输出兜底文本
```

## 与上游 pi-session-patcher 的差异

| 维度 | pi-session-patcher | pi-roles（本扩展） |
| --- | --- | --- |
| 定位 | CTF 注入 + 拦截 | **角色模板系统**（CTF 只是第一个角色） |
| 添加场景 | 改代码改模板 | 丢一个 `.md` 到 `roles/` |
| 命令 | `/ctf` 单菜单 | `/role`（`/ctf` 别名） |
| 拦截默认 | 全局开启 | **仅角色模式开启时联动生效** |
| 注入标记 | `codex-session-patcher:pi-ctf` | `pi-roles:<role>` |

## 局限

- 实时拦截只保护本会话新产生的消息；历史会话批量清理请用上游 codex-session-patcher Web UI
- 拦截基于文本特征匹配，存在理论误报；每次拦截都会通知，可关闭
- 无法突破平台最高安全策略，效果因模型版本而异
