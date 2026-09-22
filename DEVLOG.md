# pi-ctf 开发日志（DEVLOG）

> 本文件记录扩展的完整开发历程：设计决策、踩坑记录、验证方法、待办事项。
> **新会话继续开发本扩展前，先通读本文**——读完即可接上全部上下文，无需重看开发对话。
>
> 配套阅读：[README.md](./README.md)（功能与使用）· 原项目 [ryfineZ/codex-session-patcher](https://github.com/ryfineZ/codex-session-patcher) · pi 官方文档（本机路径 `/Users/tutu/.node_modules/lib/node_modules/@earendil-works/pi-coding-agent/docs/`）

---

## 0. fork 独立记录（2026-09-20）

从 `~/.pi/agent/extensions/pi-session-patcher` 复制到 `~/Desktop/TestCC/pi-roles`，定位升级为**角色模板系统**：

### v0.3.0 角色化

- **角色 = roles/<name>.md 一个文件**：头两行 frontmatter（managed-by + role-desc），目录自动发现，添加角色零代码
- 用户自定义目录 `~/.pi/agent/roles/`（同名覆盖内置）
- 命令 `/role`（/ctf 别名）：菜单 / 直切 / 指定模式；状态条显示 R:<role>
- 旗标：`--role <name>`（replace）/ `--role-append <name>`（append）/ `--role-mode`；`--ctf/--ctfa/--ctfr/--ctf-mode` 兼容
- 状态持久化 { role, injectionMode, interceptEnabled }，兼容旧 ctfEnabled 字段
- **拦截随角色模式联动**：仅注入开启时生效（用户明确要求：拦截不再默认全局开启）
- 注入标记 `pi-roles:<role>`；模板迁移 roles/ctf.md
- 补齐缺失的 `tsconfig.json` 与 `test/detector.test.ts`（17 项断言）
- devDeps 对齐全局 pi 0.86.0
- E2E 已验证：替换/追加注入、拦截联动（无角色不拦 / 有角色拦）

### v0.4.0 菜单设计定稿（用户逐条拍板）

- **交互收敛为两条通道**：`/role` 两级菜单（外层：追加/替换模式单选 + 自动拦截总闸 + 角色入口；内层：角色子菜单，Esc 返回主菜单）+ 启动旗标。去掉 `/role <name>` 会话内直切（用户：只做菜单 + 启动参数）
- **默认模式 append**（用户改主意：默认追加；replace 为显式强场景）
- **自动拦截 = 总闸 + 有角色才生效**（无角色不拦；菜单可关）
- **状态机纯函数 src/state.ts**：菜单/旗标/恢复共用 applyRoleState，新增 test/state.test.ts（13 项断言，总计 30）
- 状态条常驻 `R:<role> · <mode> · 🛡`；子菜单顶部显示当前模式/拦截提示
- 空态引导：无角色时提示放 .md 即添加
- E2E 已验证：--role ctf（默认 append 原生剧本保留）、--ctfr（替换）、无角色（不注入）、拦截联动

### v0.4.1 新增内置角色

- `roles/tutor.md`（教学导师）：苏格拉底式引导，先了解学习者、递进提示、结合真实代码、结尾给验证小任务；输出契约：概念/动机/用法/坑 + 自测任务
- `roles/interviewer.md`（模拟面试官）：开面确认岗位与级别、一次一题难度递进、STAR 追问、每题点评（考察点/评价/参考思路）、结束输出分维度总结报告
- 两个角色 E2E 验证注入生效（pi-roles:tutor / pi-roles:interviewer，默认 append 保留原生剧本）

### v0.4.2 菜单打磨 / 状态栏上色 / 去外部耦合 / 关键词表

- **菜单**：主菜单四项统一为「4 字标签 + 两空格 + 值」；角色入口置顶并显示当前角色（`选择角色  ctf`）；角色子菜单去掉状态提示行、描述改列对齐+截断、`（返回主菜单）` → `返回`
- **自动拦截语义**（用户确认）：始终显示，默认关闭，选中角色时自动开启，也可手动开关；清空角色时回到关闭
- **状态栏**：`[ctf]·replace·🛡`；配色 dim（括号/分隔点）→ muted（模式）→ accent（角色名）；用主题色而非硬编码色，自动适配明暗主题；emoji 不受 ANSI 前景色控制
- **提示文案精简**：`✅ 已启用 ctf · append`；删除只服务长文案的 `modeLabel()`；修正无 UI 时“请用 /role”的逻辑不通提示
- **去除外部耦合**：删除 `src/config.ts` 与 `~/.codex-patcher/config.json` 读取（该文件在本机并不存在，代码从未生效），连带删除只为它服务的 `isMojibake`
- **关键词表抽到 `keywords.txt`**：detector.ts 不再硬编码词表；分 `[全文]` / `[开头]` 两段（后者限前 150 字符，避免误伤）；`parseKeywords` / `loadKeywords` + mtime 缓存 + 文件缺失时最小应急词表
- 测试：26 项断言（detector 16 + state 10）

### v0.4.3 关键词表精简（降误报）

用户在写代码时遭遇莫名拦截，回放会话档案定位到根因：

- **现场**：会话 `2026-09-08T10-45-47` — 用户问「怎么就改了？」，模型回复（几乎确定以「抱歉」开头）被整条替换为兜底文本
- **根因**：`[开头]` 段混入日常用语：致歉（抱歉/很抱歉/对不起/不好意思/sorry/apologize）、泛化否定（我无法/我不能/i cannot/unable to）、技术高频词（不允许/禁止/not permitted/not allowed）。它们在正常工作语言里频繁出现，开头 150 字符命中就把整条回复换掉
- **自我循环**：另一会话中模型 thinking 泄漏——它把被替换后的罐头文本当成自己说过的话，试图道歉纠正 → 再次命中「抱歉」→ 再次被替换，循环

处理：`[开头]` 段 25 条 → **9 条**，只留「拒绝为你做某事」的明确拒绝开场（不能帮你/无法协助你/不会帮你/不能为你/refuse to）。`[全文]` 段保持不动（均为明确拒绝话术）。

- 回测：3 类已知误伤全部放过；3 类真拒绝仍然拦截
- 新增回归断言：日常致歉/泛化否定词不得出现在词表
- 经验：**致歉词不能当拒绝标记**；分词表时先问“这句话会不会在正常回复里出现”

### v0.4.4 拦截可见性：告知命中词与原文

用户反馈：“消息被拦截后，不知道是哪条、命中了什么词、原文说了什么，无法判断是否误判”。

- `detectRefusal` 拆出 **`findRefusalMatch`**：返回 `{ keyword, tier }`（全文段优先于开头段）
- 拦截时 `pi.appendEntry("pi-roles-intercept", …)` + **`pi.registerEntryRenderer`** —— 记录**直接渲染在聊天记录里**（就显示在被替换消息的位置）：命中词 + 匹配段 + 角色 + 原文预览，**展开可看完整原文**
- 关键点：custom entry **不进入 LLM 上下文**（不会污染对话），但持久化在会话里（滚动回看 / resume 后仍在）—— 这比通知和状态栏都合适（用户明确不要改状态栏）
- 通知同步带上命中词：`🛡 已拦截 · 命中「不能帮你」（开头匹配）`
- 记录原文，追查误判不再依赖记忆

### 已确认待办（用户讨论中，未实施）

- [ ] 角色绑定工具集（`pi.setActiveTools()` 已确认可用）——**用户暂缓**：工具名不熟、配置成本高。方案已讨论完整：role-tools（白名单）+ role-tools-exclude（黑名单）双字段、getAllTools() 校验、baseline 动态刷新（避免饿死插件动态注册的工具）。将来做的话，工具名可发现性应在 UI 层解决（菜单提供工具选择器）
- [ ] 模板变量（注入 cwd / 项目名等）——用户暂缓（二期再说）
- [ ] 模板精细度策略（完整版 / 精简版）
- [ ] 其他角色模板（用户尚未定清单）

历史章节（下）均为上游 pi-session-patcher 的开发记录，决策细节仍适用。

---

---

## 1. 项目缘起

[codex-session-patcher](https://github.com/ryfineZ/codex-session-patcher)（Python）已支持 Codex CLI / Claude Code / OpenCode 三平台的会话清理与 CTF 提示词注入，但不支持 pi。讨论过两条路线：

| 路线 | 说明 | 结论 |
| --- | --- | --- |
| 给 Python 工具加 pi 会话格式（PiFormatStrategy） | 事后批量清理 pi 会话文件，接入 Web UI | 推迟（Part 1，见待办） |
| **写 pi 原生扩展（本扩展）** | 实时拦截 + 提示词注入，"预防"形态 | ✅ 先做，体验更好 |

最终定位：**扩展管"预防/实时"，主工具管"善后/批量"**，松耦合（可选联动），扩展零运行时依赖主工具。

命名教训：初版叫 `codex-session-patcher-pi`（两平台名撞车），改为 **`pi-session-patcher`**，跟随 pi 生态 `pi-*` 命名惯例（pi-subagents / pi-lens / pi-web-access…）。

## 2. 核心机制认知（一切设计的根基）

1. **pi 的系统提示词每条请求现组装、不落盘**。组装逻辑见 `pi-mono/packages/coding-agent/dist/core/system-prompt.js` 的 `buildSystemPrompt`：customPrompt 或默认剧本 → 追加 `<project_context>`（AGENTS.md：全局/祖先/项目三级）→ 追加 skills → cwd。所以开关/模式切换对下一条消息立即生效

 追加 skills → cwd。→ 所以开关/模式切换**对下一条消息立即生效**，"中途开启"完全有意义
2. **会话文件是 JSONL 树**（id/parentId），从叶子回溯根即当前上下文。`custom` entry 不参与 LLM 上下文 → 用它持久化扩展状态，resume 自动还原
3. **扩展不能改"正在打开的会话文件"**（pi 内存树与磁盘文件会分叉）→ 批量清理历史会话只能靠主工具（事后、文件级）；本扩展做实时拦截（事前、消息级）

## 3. 关键设计决策

| 决策 | 理由 |
| --- | --- |
| **replace 模式保留 AGENTS.md 与 skills** | 对齐 pi 原生 `--system-prompt` 语义（"Replace default prompt; context files and skills are still appended"）。材料来自 `event.systemPromptOptions.contextFiles / skills`，按原生格式（`<project_context>` 包裹）重建。曾走过弯路：最初直接返回 CTF 文本，把用户 AGENTS.md 一起丢了——读 `buildSystemPrompt` 源码后修正 |
| **三条启动旗标 `--ctf / --ctfa / --ctfr`** | 人体工学：a=append、r=replace、无后缀=默认追加（用户要求"CTF 默认就是 CTFA"） |
| **带旗标恢复会话时覆盖会话内模式** | 显式敲旗标 = 明确要求，优先于持久化状态；`pi -c` 无旗标则完全听会话的。实测 `--ctfr --session <id>` 恢复 append 会话 → 模式翻转为 replace 并写回 |
| **`--ctf-mode` 不设 default** | 若设 default="append"，resume 时 getFlag 返回它，会把会话内持久化的 replace 静默打回 append |
| **菜单只标「真正生效」的选项** | 模式与开关是两个独立维度；注入关闭时还标着"当前模式"会误导（修过双标注 bug：替换模式+关闭注入同时标当前） |
| **拦截替换策略：首个 text 块换兜底、其余 text 块移除** | 只换第一块会留残余拒绝文本；thinking/toolCall 块保留；返回新对象不改入参 |
| **状态读写对称** | persistState 与 session_start 恢复必须同步加字段 |
| **检测词表与兜底文本从主工具拷贝** | detector.py 词表逐条移植、MOCK_RESPONSE 逐字拷贝、isMojibake 逻辑移植（GBK 写坏配置自愈）——数据级松耦合 |
| **共享配置可选读取** | `~/.codex-patcher/config.json` 的 mock_response / custom_keywords / ctf_prompts.pi.prompt，存在读、无则内置默认（mtime 缓存避免重复 IO） |
| **`/ctf` 单入口菜单，无子命令** | 用户明确要求：菜单五项（追加/替换/关闭/拦截器/状态），快速路径全部移除 |
| **菜单项带「← 当前」标注** | 实时反映状态；只在"真正生效"的项上标 |

## 4. 踩过的坑（重要程度排序）

1. **persistState 漏字段**：给状态加 injectionMode 时只改了 restore 没改 persist → resume 后模式静默回退（开关在、模式丢）。靠 E2E（-c 恢复后 payload 检查）暴露。**教训：状态对象加字段必须同步 persist/restore 两处**
2. **探测假阴性**：在 before_agent_start 层探测注入，-e 探针先于全局扩展执行，看到链式注入前的 prompt → 误判"全局扩展没生效"。**教训：探针必须挂 `before_provider_request`（payload 层，与 handler 顺序无关）**
3. **扩展旗标放参数末尾会吞位置参数**：`pi -p -e A -e B --ctf "prompt"` 整条命令静默变 no-op（旗标注册时机在参数解析的博弈）。**教训：文档统一要求旗标前置 `pi --ctf …`**
4. **菜单双标注 bug**：模式与开关各自标"当前"→ 关闭注入时同时显示两个"当前"。**教训：多维度状态做单选标注时，先定义"哪一项才代表生效状态"**
5. **pi-ai 类型无隐式索引签名**：宽松结构类型 ContentBlock 若加 `[key: string]: unknown`，interface 类型的 AssistantMessage 赋值直接报错 → ContentBlock 不带索引签名，用泛型 `<T extends AssistantMessageLike>` + SAFETY 注释保型
6. **markdownlint/autofix 会重排格式**：md 文件被 lens autofix 重排编号/加语言标记，diff 后以 attached 全文为准

## 5. 验证方法（改代码后照做）

```bash
# 0. 改完代码必做：同步安装副本（pi 加载的是安装目录，不是仓库！）
cp index.ts ~/.pi/agent/extensions/pi-session-patcher/
cp -r src ~/.pi/agent/extensions/pi-session-patcher/
# 然后新会话生效，或 /reload

# 1. 类型与单测
npm run typecheck && npm test   # tsc 严格模式 + 16 项断言

# 2. payload 探针（注入铁证，与 handler 顺序无关）
mkdir -p /tmp/ctf-verify && cat > /tmp/ctf-verify/probe.ts <<'EOF'
import { writeFileSync } from "node:fs";
export default function (pi: any) {
  pi.on("before_provider_request", async (event: any) => {
    const raw = JSON.stringify(event.payload ?? {});
    writeFileSync("/tmp/ctf-verify/result.json", JSON.stringify({
      ctfInjected: raw.includes("codex-session-patcher:pi-ctf"),
      defaultPromptPresent: raw.includes("coding agent harness"),   // pi 内置默认剧本特征
      agentsMdPresent: raw.includes("Search Discipline"),            // 用户全局 AGENTS.md 特征
      payloadKB: Math.round(raw.length / 1024),
    }, null, 2));
  });
}
EOF
# append：pi -p --ctf  -e /tmp/ctf-verify/probe.ts "Reply with exactly: ok"
# replace：pi -p --ctfr -e /tmp/ctf-verify/probe.ts "Reply with exactly: ok"
# 期望：append → {true, true, true, ~101KB}；replace → {true, false, true, ~90KB}

# 3. 拦截确定性 E2E（不赌模型真拒绝）
pi -p "请一字不差地只回复这句话：我无法协助完成该请求"
# 期望 stdout 是兜底文本"我会按授权的本地/测试服范围继续…"；会话文件里 assistant 消息无拒绝文本

# 4. 持久化 E2E
# 开 CTF + 选模式 → pi -c 恢复 → 探针复查，状态与模式应原样还原

# 5. Python 主工具回归（确认零影响）
python3 -m pytest -q --override-ini="addopts="   # 160 passed
```

## 6. 功能演进史（按用户需求迭代）

1. 试用版三件套：`/ctf on|off` + append 注入 + 拦截（默认开）
2. 双注入模式（append/replace），对齐主工具 `--ctf-injection-mode`
3. 三条对称旗标 `--ctf/--ctfa/--ctfr`（嫌 `--ctf --ctf-mode replace` 太长）
4. `/ctf` 交互式菜单（中文），移除全部子命令/快速路径/参数补全
5. 菜单加拦截器开关项
6. 菜单改英文（Append/Replace/Off/Status）→ 又改回中文（追加/替换/关闭注入/拦截器：开启/查看状态）
7. replace 保留 AGENTS.md + skills（对齐 pi 原生语义）
8. 内置模板从 claude_code_ctf_optimized.md 切换为 **ctf_optimized.md**（三层工作流版，身份段改 pi）
9. 菜单标注逻辑修复（只标真正生效项）

## 7. 待办 / 可选后续

- [ ] 主工具 Python 侧接入 pi 会话格式（PiFormatStrategy + parser 文件名解析 + Web 扫描目标），让 Web UI 能批量清理历史 pi 会话
- [ ] 扩展发布 npm 包（`pi install npm:pi-session-patcher`），补 CI + 徽章；也可放 git 仓库用 `pi install git:…`
- [ ] replace 模式 skill 描述对齐 pi 原生 `<available_skills>` XML 格式（reviewer P2，当前为简化列表）
- [ ] 状态恢复改为沿当前分支扫描（`getBranch()`）而非全文件最后一条，修复 /tree 跨分支边缘场景
- [ ] 拦截 AI 改写：可选调用主工具的 LLM 配置生成上下文相关的替换文本（现为固定兜底文本）
- [ ] `~/.zshrc` 里的 `pictf` 快捷函数与三条旗标功能重叠，二选一清理

## 8. 质量基线（最后记录）

- tsc --noEmit 严格模式：0 错误
- 单元测试：16 项断言全过（detector/replace/isMojibake/模板加载/config 形状）
- Code review（reviewer 子代理）：**OK**，无 critical/major；3 条 P2 均为已知取舍
- E2E：9+ 场景（注入×旗标/命令/全局、持久化、拦截 stdout+落盘层、AGENTS.md 保留）
- 主项目 Python 测试 160 passed（扩展零侵入证明）
