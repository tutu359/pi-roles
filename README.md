# pi-roles — 角色模板系统

> 从 [pi-session-patcher](../.pi/agent/extensions/pi-session-patcher) fork 独立的 pi 扩展。
> 以「角色」为单位管理提示词模板：**一个角色 = `roles/<name>.md` 一个文件，放目录即自动出现，添加角色零代码**。

## 功能

### 1. 角色模板系统

| 模式 | 用途 | 行为 |
| --- | --- | --- |
| **append（默认）** | 日常 / 委派 | 在现有系统提示词**末尾追加**角色模板，原生剧本与父上下文完整保留 |
| **replace** | 主会话强场景 | 用角色模板**替换** pi 内置默认剧本；**AGENTS.md 与 skill 清单仍保留** |

- 交互收敛为**两条通道**：`/role` 菜单（选择/设置）+ 启动旗标（`--role <name>`）
- 状态与模式按会话持久化，`pi -c` / resume 自动恢复；状态条常驻 `[ctf]·replace·🛡`（角色名主题高亮色，括号/分隔点淡色，模式中间调）
- 内置角色：`ctf`（CTF/渗透测试三层工作流）、`tutor`（教学导师，苏格拉底式引导）、`interviewer`（模拟面试官，出题+点评）
- **自定义角色**：`~/.pi/agent/roles/<name>.md`（同名覆盖内置）

### 2. 实时拒绝拦截（随角色联动）

- **开关默认关闭，选中角色时自动开启**（也可手动开关）
- 助手消息定稿时检测拒绝回复（命中 **`keywords.txt`** 里的词），命中即替换为内置兜底文本，拒绝内容不落盘
- **拦截了什么、命中了哪个词、原文是什么——直接显示在聊天记录里**：

```text
🛡 已自动拦截 · 命中「不能帮你」（开头匹配） · 角色 ctf
   │ 原文：抱歉，我刚才那个改动……
```

- 这条记录是 pi 的 custom entry：**不进入 LLM 上下文**，但会持久化在会话里（滚动回看/resume 后仍在）；默认只显示原文预览，**展开可看完整原文**
- 同时会弹一个简短通知：`🛡 已拦截 · 命中「不能帮你」（开头匹配）`

## 安装

```bash
# 方式一：从 git 安装（推荐，后续迭代通过 git 更新）
pi install git:github.com/tutu359/pi-roles

# 方式二：复制到全局扩展目录
cp -r ~/Desktop/TestCC/pi-roles ~/.pi/agent/extensions/pi-roles

# 方式三（开发调试，不安装）：pi --role ctf -e ~/Desktop/TestCC/pi-roles/index.ts …
```

## 使用

### /role 菜单（两级）

**外层 · 主菜单**（模式单选 + 拦截开关 + 入口）：

```text
┌ pi-roles 主菜单 ─────────────────┐
│ > 追加模式            ← 当前      │ ← 当前模式（默认 append）
│   替换模式                        │
│   自动拦截：开启                  │ ← 拦截总闸（有角色才生效）
│   ──────────────────────────     │
│   角色                            │ ← 进入角色子菜单
│   查看状态                        │
└──────────────────────────────────┘
```

**内层 · 角色子菜单**（选具体角色，Esc 返回主菜单）：

```text
┌ 选择角色 ────────────────────────┐
│  （当前模式：append · 拦截：开）   │
│ > ctf：CTF / 渗透测试专家         │
│   tutor：教学讲解与答疑           │
│   …                              │
│  （返回主菜单）                   │
└──────────────────────────────────┘
```

- 主菜单 Esc = 退出；角色子菜单 Esc = 返回主菜单
- 选角色后返回主菜单，便于继续调整模式/拦截；状态条实时更新
- **菜单里改什么都不弹通知；Esc 退出时统一报一次最终结果**（如 `已启用 tutor · append · 自动拦截开`），此时所有选择已确定、不会过期；菜单内没有改动则不打扰

### CLI 旗标（需放在其他旗标之前）

| 旗标 | 说明 |
| --- | --- |
| `pi --role <name>` | 指定角色启动（默认追加模式），如 `--role ctf` |
| `pi --role-append <name>` | 指定角色 + 追加模式（显式，委派场景） |
| `pi --role-mode replace\|append` | 模式覆盖 |
| `pi --ctfr` | 快捷：ctf 角色 + 替换模式 |
| `pi --ctfa` / `--ctf` | 快捷：ctf 角色 + 追加模式 |
| `pi --ctf-mode replace\|append` | `--role-mode` 的旧名（兼容） |

## 添加新角色（零代码）

在 `roles/`（内置）或 `~/.pi/agent/roles/`（用户级，同名覆盖内置）放一个 `<name>.md`：

```markdown
<!-- managed-by: pi-roles:<name> -->
<!-- role-desc: <一句话用途，显示在角色子菜单> -->
<角色人设 + 行为规则 + 输出契约>
```

保存后立即出现在角色子菜单，选中即可启用。

## 拦截关键词表（keywords.txt）

拦截命中的词全部在仓库根目录的 **`keywords.txt`** 里维护，代码里不写死：

```text
[全文]
我无法协助          # 出现在回复任意位置即触发
...

[开头]
抱歉                # 仅在回复开头 150 字符内触发（避免误伤）
...
```

- 增删词直接改文件，不需要改代码；改完 `/reload` 或新开会话生效
- 一行一个词，`#` 开头的行是注释，空行忽略，匹配不区分大小写
- 段落标记之前的关键词默认归入 `[全文]`
- 文件缺失时使用最小应急词表（避免拦截静默失效）
- 拦截后的替换文本目前固定为内置兜底句

## 开发

```bash
pnpm install        # 安装 devDeps（typescript / @types/node / pi 类型）
pnpm typecheck      # tsc --noEmit
pnpm test           # node --experimental-strip-types 直接运行单元测试（26 项断言）
```

源码结构：

```text
pi-roles/
├── index.ts              # 入口：/role 两级菜单、角色注入、拦截、状态持久化
├── keywords.txt          # ⭐ 拦截关键词表（命中即触发拦截）
├── roles/                # ⭐ 角色模板目录（放 .md = 一个角色）
│   ├── ctf.md            # CTF 角色（标记 pi-roles:ctf）
│   ├── interviewer.md    # 模拟面试官
│   └── tutor.md          # 教学导师
├── src/
│   ├── state.ts          # 状态机纯函数（菜单/会话恢复共用；可单测）
│   ├── prompts.ts        # 角色加载/发现（内置 + ~/.pi/agent/roles/）+ 兜底文本
│   └── detector.ts       # 关键词表加载/解析 + 拒绝检测 + 文本提取/替换
└── test/                 # detector + state 单元测试（26 项断言）
```

### E2E 验证

```bash
mkdir -p /tmp/ctf-verify
# 追加（默认）：pi --role ctf -ne -p -e /tmp/ctf-verify/probe.ts -e index.ts "Reply with exactly: ok"
#   期望：{ ctfInjected: true, defaultPromptPresent: true（原生剧本保留）}
# 替换：pi --ctfr … 期望 defaultPromptPresent: false
# 无角色：pi -e index.ts … 期望 ctfInjected: false
# 拦截联动：无角色 → 拒绝回复原样；--role ctf → 输出兜底文本
```

## 与上游 pi-session-patcher 的差异

| 维度 | pi-session-patcher | pi-roles（本扩展） |
| --- | --- | --- |
| 定位 | CTF 注入 + 拦截 | **角色模板系统**（CTF 只是第一个角色） |
| 添加场景 | 改代码改模板 | 丢一个 `.md` 到 `roles/` |
| 交互 | `/ctf` 单菜单 + 命令直切 | **/role 两级菜单** + 启动旗标 |
| 默认模式 | append（v0.3.0 曾改 replace） | **append** |
| 拦截默认 | 全局开启 | **总闸 + 有角色才生效** |
| 注入标记 | `codex-session-patcher:pi-ctf` | `pi-roles:<role>` |

## 局限

- 实时拦截只保护本会话新产生的消息；历史会话批量清理请用上游 codex-session-patcher Web UI
- 拦截基于文本特征匹配，存在理论误报；每次拦截都会通知，可关闭
- 无法突破平台最高安全策略，效果因模型版本而异
