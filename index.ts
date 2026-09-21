/**
 * pi-roles — 角色模板系统（从 pi-session-patcher fork 独立）
 *
 * 以「角色」为单位管理提示词模板：一个角色 = roles/<name>.md 一个文件，
 * 放目录即自动出现在角色子菜单，添加角色零代码。
 *
 * 交互（两条通道）：
 * - /role 菜单：外层主菜单（追加/替换模式、自动拦截）→ 角色子菜单（选择具体角色）
 * - 启动旗标：pi --role <name> / --role-append <name> / --ctf* 快捷旗标
 *
 * 注入模式：
 * - append（默认）：在现有系统提示词末尾追加角色模板（保留原生剧本），委派子代理场景
 * - replace：用角色模板替换 pi 内置默认剧本（保留 AGENTS.md 与 skill 清单），主会话强场景
 *
 * 附带能力：实时拒绝拦截（会话清理的事前版）。拦截总闸默认开，但仅当有角色时生效
 * （无角色 = 注入关闭，拦截一并停用）。助手消息定稿时检测拒绝回复，命中则替换为
 * 配合性兜底文本，避免「拒绝记忆」污染后续 resume / 续聊。
 *
 * 可选松耦合：本机存在 ~/.codex-patcher/config.json 时，读取
 * mock_response（兜底文本）、custom_keywords（自定义检测词）、
 * ctf_prompts.pi.prompt（ctf 角色模板覆盖）。不安装主工具也完整可用。
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  detectRefusal,
  extractAssistantText,
  replaceAssistantTextBlocks,
} from "./src/detector.ts";
import {
  FALLBACK_RESPONSE,
  PACKAGE_MARKER,
  roleMarker,
  listRoles,
  getRoleContent,
  hasRole,
  isMojibake,
} from "./src/prompts.ts";
import {
  CSP_CONFIG_PATH,
  loadCspConfig,
  type CspConfig,
} from "./src/config.ts";
import {
  applyRoleState,
  defaultRoleState,
  interceptActive,
  isInjectionMode,
  statusShort,
  type RoleState,
} from "./src/state.ts";

/** 会话内状态持久化使用的 custom entry 类型 */
const STATE_ENTRY_TYPE = "pi-roles-state";

/** 状态条标识 */
const STATUS_KEY = "pi-roles";

/** 事件与命令处理器共用的最小 UI 上下文（ExtensionContext / ExtensionCommandContext 均可赋值） */
type UiCtx = Pick<ExtensionContext, "hasUI" | "ui">;

export default function piRolesExtension(pi: ExtensionAPI) {
  // ── 会话内状态（默认：无角色 · 追加模式 · 拦截开） ─────────────────────────
  let state: RoleState = defaultRoleState();
  let intercepted = 0; // 本会话拦截计数
  let config: CspConfig = { customKeywords: [], configFound: false };

  // ─── 工具函数 ───────────────────────────────────────────────────────────

  /** 取角色模板：ctf 角色允许 ~/.codex-patcher/config.json 覆盖 */
  function getRolePrompt(name: string): string {
    if (name === "ctf" && config.ctfPrompt?.trim()) {
      return config.ctfPrompt.trim();
    }
    return getRoleContent(name);
  }

  function getFallbackText(): string {
    if (config.mockResponse && !isMojibake(config.mockResponse)) {
      return config.mockResponse;
    }
    return FALLBACK_RESPONSE;
  }

  function notify(
    ctx: UiCtx,
    text: string,
    level: "info" | "warning" | "error" = "info",
  ): void {
    try {
      if (ctx?.hasUI) ctx.ui?.notify?.(text, level);
    } catch {
      // UI 通知失败不影响主流程
    }
  }

  function applyStatus(ctx: UiCtx): void {
    try {
      ctx?.ui?.setStatus?.(STATUS_KEY, statusShort(state));
    } catch {
      // 状态条不可用时忽略
    }
  }

  function persistState(): void {
    try {
      pi.appendEntry(STATE_ENTRY_TYPE, {
        role: state.role,
        mode: state.mode,
        intercept: state.intercept,
      });
    } catch {
      // 持久化失败只影响 resume 恢复，不影响本次会话
    }
  }

  function modeLabel(): string {
    return state.mode === "replace"
      ? "replace（替换系统提示词，主会话）"
      : "append（追加，保留原生剧本）";
  }

  function statusText(): string {
    const roles = listRoles();
    return [
      `${PACKAGE_MARKER} (角色模板系统 · 从 pi-session-patcher fork)`,
      `· 当前角色: ${state.role ?? "无（注入关闭）"} — 模式: ${modeLabel()} — 可用角色: ${
        roles.map((r) => r.name).join(" / ") || "（无）"
      }`,
      `· 自动拦截: ${state.intercept ? "✅ 开启" : "关闭"}${
        state.role ? "" : "（有角色时才生效）"
      } — 本会话已拦截 ${intercepted} 条`,
      `· 兜底替换文本: ${config.mockResponse ? "~/.codex-patcher/config.json" : "内置默认"}`,
      `· 共享配置: ${config.configFound ? CSP_CONFIG_PATH : "未找到（使用内置默认）"}`,
      `· 注入标记: ${state.role ? roleMarker(state.role) : "—"}`,
    ].join("\n");
  }

  // ─── 命令行旗标 ─────────────────────────────────────────────────────────

  // --ctf/--ctfa/--ctfr：CTF 角色快捷旗标（兼容 pi-session-patcher 习惯）
  pi.registerFlag("ctf", {
    description: "以 CTF 角色启动（追加模式，等价 --role-append ctf）",
    type: "boolean",
    default: false,
  });

  // 字符串旗标不设 default：未传时 getFlag 返回 undefined，避免 resume 时把
  // 会话内持久化的模式误重置。
  pi.registerFlag("ctf-mode", {
    description: "注入模式覆盖：replace 替换 / append 追加（--role-mode 旧名）",
    type: "string",
  });

  pi.registerFlag("ctfr", {
    description: "以 CTF 角色 + 替换模式启动（主会话强 CTF）",
    type: "boolean",
    default: false,
  });

  pi.registerFlag("ctfa", {
    description: "以 CTF 角色 + 追加模式启动（等价 --ctf）",
    type: "boolean",
    default: false,
  });

  // --role <name>：通用角色旗标（模式用全局默认，即 append）
  pi.registerFlag("role", {
    description: "以指定角色启动（默认追加模式），如 --role ctf / --role tutor",
    type: "string",
  });

  // --role-append <name>：显式追加模式（与 --role 默认一致，保留显式语义）
  pi.registerFlag("role-append", {
    description: "以指定角色 + 追加模式启动（委派子代理场景），如 --role-append ctf",
    type: "string",
  });

  // --role-mode：模式覆盖（新名）；--ctf-mode 保留兼容
  pi.registerFlag("role-mode", {
    description: "注入模式覆盖：replace 替换 / append 追加",
    type: "string",
  });

  // ─── 菜单 ───────────────────────────────────────────────────────────────

  /** 角色子菜单：选择具体角色；Esc 返回主菜单 */
  async function roleSubMenu(ctx: UiCtx): Promise<void> {
    const roles = listRoles();
    if (roles.length === 0) {
      notify(
        ctx,
        "暂无角色：把 <名字>.md 放进 roles/ 或 ~/.pi/agent/roles/ 即可添加",
        "warning",
      );
      return;
    }
    const items = [
      `（当前模式：${state.mode} · 拦截：${state.intercept ? "开" : "关"}）`,
      ...roles.map(
        (r) =>
          `${r.name}：${r.desc}${state.role === r.name ? "  ← 当前" : ""}`,
      ),
      "（返回主菜单）",
    ];
    try {
      const picked = await ctx.ui.select("选择角色", items);
      if (picked === undefined) return; // Esc 返回主菜单
      const idx = items.indexOf(picked);
      if (idx === 0) return; // 提示行，忽略
      if (idx === items.length - 1) return; // 返回主菜单
      const role = roles[idx - 1];
      state = applyRoleState(state, { type: "selectRole", role: role.name });
      persistState();
      applyStatus(ctx);
      notify(ctx, `✅ 角色「${role.name}」已启用（${modeLabel()}）`);
      // 返回主菜单，便于继续调整模式/拦截
    } catch {
      notify(ctx, "菜单不可用，已取消（未做任何变更）", "warning");
    }
  }

  /** 外层主菜单：模式单选 + 自动拦截 + 进入角色子菜单；Esc 退出 */
  async function mainMenu(ctx: UiCtx): Promise<void> {
    for (;;) {
      const items = [
        `追加模式${state.mode === "append" ? "  ← 当前" : ""}`,
        `替换模式${state.mode === "replace" ? "  ← 当前" : ""}`,
        `自动拦截：${state.intercept ? "开启" : "关闭"}${
          state.role ? "" : "（有角色时才生效）"
        }`,
        "──────────────",
        "角色",
        "查看状态",
      ];
      let picked: string | undefined;
      try {
        picked = await ctx.ui.select("pi-roles 主菜单", items);
      } catch {
        notify(ctx, "菜单不可用，已取消（未做任何变更）", "warning");
        return;
      }
      if (picked === undefined) return; // Esc 退出
      const idx = items.indexOf(picked);
      if (idx === 0) {
        state = applyRoleState(state, { type: "setMode", mode: "append" });
        persistState();
        applyStatus(ctx);
      } else if (idx === 1) {
        state = applyRoleState(state, { type: "setMode", mode: "replace" });
        persistState();
        applyStatus(ctx);
      } else if (idx === 2) {
        state = applyRoleState(state, { type: "toggleIntercept" });
        persistState();
        applyStatus(ctx);
        notify(
          ctx,
          state.intercept
            ? "✅ 自动拦截已开启（有角色时生效）"
            : "自动拦截已关闭",
        );
      } else if (idx === 3) {
        // 分隔线装饰行，忽略
      } else if (idx === 4) {
        await roleSubMenu(ctx);
      } else if (idx === 5) {
        notify(ctx, statusText());
      }
    }
  }

  // ─── 命令: /role（/ctf 为别名） ──────────────────────────────────────────

  const roleMenuHandler = async (args: unknown, ctx: UiCtx): Promise<void> => {
    const argText = typeof args === "string" ? args.trim() : "";
    if (argText) {
      // 会话内直切暂不支持（交互收敛为菜单 + 启动旗标两条通道）
      notify(
        ctx,
        "会话内请用 /role 菜单选择角色；启动时可用 --role <name> 或 --role-append <name> 旗标",
        "info",
      );
      return;
    }
    if (!ctx.hasUI) {
      notify(
        ctx,
        "交互式菜单仅支持交互界面（TUI）；启动时请用 --role <name> / --role-append <name> 旗标",
        "warning",
      );
      return;
    }
    await mainMenu(ctx);
  };

  pi.registerCommand("role", {
    description: "pi-roles: 角色菜单（外层：模式/拦截 → 角色子菜单）",
    handler: roleMenuHandler,
  });

  // /ctf = /role 别名（兼容旧习惯）
  pi.registerCommand("ctf", {
    description: "pi-roles: /role 的别名（角色菜单）",
    handler: roleMenuHandler,
  });

  // ─── 会话启动: 恢复状态 + 读取共享配置 + 处理启动旗标 ──────────────────────

  pi.on("session_start", async (_event, ctx) => {
    config = loadCspConfig();
    state = defaultRoleState();
    intercepted = 0;

    // 从会话 custom entry 恢复（兼容旧字段：ctfEnabled → ctf 角色、interceptEnabled → intercept、injectionMode → mode）
    try {
      for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type !== "custom") continue;
        if (entry.customType !== STATE_ENTRY_TYPE) continue;
        const data = entry.data as
          | {
              role?: unknown;
              ctfEnabled?: unknown;
              interceptEnabled?: unknown;
              injectionMode?: unknown;
              intercept?: unknown;
              mode?: unknown;
            }
          | undefined;
        if (!data) continue;
        if (typeof data.role === "string" && hasRole(data.role))
          state = { ...state, role: data.role };
        if (
          typeof data.ctfEnabled === "boolean" &&
          data.ctfEnabled &&
          !state.role
        ) {
          state = { ...state, role: "ctf" }; // 旧条目兼容
        }
        const intercept = data.intercept ?? data.interceptEnabled;
        if (typeof intercept === "boolean")
          state = { ...state, intercept };
        const mode = data.mode ?? data.injectionMode;
        if (isInjectionMode(mode)) state = { ...state, mode };
      }
    } catch {
      // 状态恢复失败按默认值处理
    }

    // 启动旗标强制开启并持久化（显式敲旗标 = 明确要求，优先于持久化状态）
    try {
      const ctfr = pi.getFlag("ctfr") === true;
      const ctfa = pi.getFlag("ctfa") === true;
      let reqRole: string | null = null;
      let reqMode = state.mode;
      if (ctfr) {
        reqRole = "ctf";
        reqMode = "replace";
      } else if (ctfa || pi.getFlag("ctf")) {
        reqRole = "ctf";
        reqMode = "append";
      }
      const roleFlag = pi.getFlag("role");
      const roleAppendFlag = pi.getFlag("role-append");
      if (typeof roleFlag === "string" && roleFlag.trim()) {
        reqRole = roleFlag.trim();
      }
      if (typeof roleAppendFlag === "string" && roleAppendFlag.trim()) {
        reqRole = roleAppendFlag.trim();
        reqMode = "append";
      }
      const flagMode = pi.getFlag("role-mode") ?? pi.getFlag("ctf-mode");
      if (isInjectionMode(flagMode)) reqMode = flagMode;
      if (reqRole && hasRole(reqRole)) {
        state = applyRoleState(state, { type: "selectRole", role: reqRole });
        state = applyRoleState(state, { type: "setMode", mode: reqMode });
        persistState();
      }
    } catch {
      // 旗标读取失败按未启用处理
    }

    applyStatus(ctx);
  });

  // ─── 角色提示词注入 ──────────────────────────────────────────────────────

  pi.on("before_agent_start", async (event) => {
    if (!state.role) return undefined;
    const prompt = getRolePrompt(state.role);
    if (state.mode === "replace") {
      // 替换模式：以角色模板为基底，但保留 AGENTS.md 等上下文文件与 skill 清单
      // （对齐 pi 原生 --system-prompt 语义：只替换内置默认剧本，不屏蔽用户自己的上下文）
      const parts: string[] = [prompt];
      const opts = event.systemPromptOptions;
      const contextFiles = opts?.contextFiles ?? [];
      if (contextFiles.length > 0) {
        parts.push(
          "\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n",
        );
        for (const file of contextFiles) {
          parts.push(
            `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n\n`,
          );
        }
        parts.push("</project_context>\n");
      }
      const skills = opts?.skills ?? [];
      if (skills.length > 0) {
        const skillLines = skills
          .map((s: { name?: string; description?: string }) =>
            `- ${s.name ?? "?"}: ${s.description ?? ""}`.trimEnd(),
          )
          .join("\n");
        parts.push(`\n## Available skills\n\n${skillLines}\n`);
      }
      return { systemPrompt: parts.join("") };
    }
    return { systemPrompt: `${event.systemPrompt}\n\n${prompt}` };
  });

  // ─── 实时拒绝拦截（随角色联动：总闸开 && 有角色才生效） ─────────────────────

  pi.on("message_end", async (event, ctx) => {
    if (!interceptActive(state)) return undefined;

    const message = event.message;
    if (message.role !== "assistant") return undefined;

    const text = extractAssistantText(message);
    if (!text || !text.trim()) return undefined;

    const fallback = getFallbackText();
    if (text.trim() === fallback.trim()) return undefined; // 已是兜底文本，避免重复处理

    if (!detectRefusal(text, config.customKeywords)) return undefined;

    const replaced = replaceAssistantTextBlocks(message, fallback);
    intercepted += 1;
    notify(
      ctx,
      `🛡 ${PACKAGE_MARKER}: 已拦截 1 条拒绝回复并替换为配合性内容（本会话累计 ${intercepted} 条）`,
      "warning",
    );
    return { message: replaced };
  });
}
