/**
 * pi-roles — 角色模板系统（从 pi-session-patcher fork 独立）
 *
 * 定位：以「角色」为单位管理提示词模板。一个角色 = roles/<name>.md 一个文件，
 * 放目录即自动出现在 /role 菜单，添加角色零代码。
 *
 * - replace（默认）：用角色模板替换 pi 内置默认剧本（保留 AGENTS.md 与 skill 清单），
 *   适合主会话换角色人设。
 * - append：在现有系统提示词末尾追加角色模板（保留原生剧本与父上下文），
 *   留给「委派」：子代理 fork 父会话上下文时带角色上场。
 *
 * 附带能力：实时拒绝拦截（会话清理的事前版）。
 * 拦截随角色模式联动：只有开启角色注入时才自动生效，其他模式关闭。
 * 助手消息定稿时（message_end）检测拒绝回复，命中则将文本替换为配合性内容，
 * 避免「拒绝记忆」污染后续 resume / 续聊。
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

/** 会话内状态持久化使用的 custom entry 类型 */
const STATE_ENTRY_TYPE = "pi-roles-state";

/** 状态条标识 */
const STATUS_KEY = "pi-roles";

/** 事件与命令处理器共用的最小 UI 上下文（ExtensionContext / ExtensionCommandContext 均可赋值） */
type UiCtx = Pick<ExtensionContext, "hasUI" | "ui">;

/** 注入模式：replace 完全替换系统提示词（默认，主会话换角色）；append 在现有系统提示词后追加（委派子代理场景） */
type InjectionMode = "append" | "replace";

function isInjectionMode(value: unknown): value is InjectionMode {
  return value === "append" || value === "replace";
}

export default function piRolesExtension(pi: ExtensionAPI) {
  // ── 会话内状态 ──────────────────────────────────────────────────────────
  let activeRole: string | null = null; // 当前角色（null = 注入关闭，按会话持久化）
  let interceptEnabled = true; // 实时拒绝拦截开关（按会话持久化；仅角色模式下生效）
  let injectionMode: InjectionMode = "replace"; // 注入模式：replace 替换（默认，主会话）/ append 追加（委派，按会话持久化）
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
      ctx?.ui?.setStatus?.(STATUS_KEY, activeRole ? `R:${activeRole}` : undefined);
    } catch {
      // 状态条不可用时忽略
    }
  }

  function persistState(): void {
    try {
      pi.appendEntry(STATE_ENTRY_TYPE, {
        role: activeRole,
        interceptEnabled,
        injectionMode,
      });
    } catch {
      // 持久化失败只影响 resume 恢复，不影响本次会话
    }
  }

  function modeLabel(): string {
    return injectionMode === "replace"
      ? "replace（替换系统提示词，主会话）"
      : "append（追加，委派子代理）";
  }

  function statusText(): string {
    const roles = listRoles();
    return [
      `${PACKAGE_MARKER} (角色模板系统 · 从 pi-session-patcher fork)`,
      `· 当前角色: ${activeRole ?? "无（注入关闭）"} — 模式: ${modeLabel()} — 可用角色: ${
        roles.map((r) => r.name).join(" / ") || "（无）"
      }`,
      `· 实时拒绝拦截: ${interceptEnabled ? "✅ 开启" : "关闭"}（仅角色模式下生效）— 本会话已拦截 ${intercepted} 条`,
      `· 兜底替换文本: ${config.mockResponse ? "~/.codex-patcher/config.json" : "内置默认"}`,
      `· 共享配置: ${config.configFound ? CSP_CONFIG_PATH : "未找到（使用内置默认）"}`,
      `· 注入标记: ${activeRole ? roleMarker(activeRole) : "—"}`,
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
    description: "注入模式：replace 替换系统提示词（默认）/ append 追加（委派场景）",
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

  // --role <name>：通用角色旗标（默认 replace）
  pi.registerFlag("role", {
    description: "以指定角色 + 替换模式启动，如 --role ctf / --role code-review",
    type: "string",
  });

  // --role-append <name>：通用角色旗标（append，委派场景）
  pi.registerFlag("role-append", {
    description: "以指定角色 + 追加模式启动（委派子代理场景），如 --role-append ctf",
    type: "string",
  });

  // --role-mode：模式覆盖（新名）；--ctf-mode 保留兼容
  pi.registerFlag("role-mode", {
    description: "注入模式：replace 替换 / append 追加",
    type: "string",
  });

  // ─── 命令: /role（/ctf 为别名） ──────────��──────────────────────────────

  const roleMenuHandler = async (args: unknown, ctx: UiCtx): Promise<void> => {
    const roles = listRoles();
    const parts = (typeof args === "string" ? args : "").trim().split(/\s+/).filter(Boolean);
    const name = parts[0];
    const modeArg = parts[1];
    const mode = isInjectionMode(modeArg) ? modeArg : undefined;

    // /role <name> [replace|append]：直切角色
    if (name) {
      if (!hasRole(name)) {
        notify(
          ctx,
          `角色「${name}」不存在。可用：${roles.map((r) => r.name).join(" / ") || "（无）"}`,
          "error",
        );
        return;
      }
      if (mode) injectionMode = mode;
      activeRole = name;
      persistState();
      applyStatus(ctx);
      notify(
        ctx,
        `✅ 角色「${name}」已启用（${modeLabel()}；拦截随角色模式自动开启）`,
        "info",
      );
      return;
    }

    // /role：交互式菜单（只标注真正生效的选项）
    const menuItems = [
      ...roles.map(
        (r) =>
          `角色 ${r.name}：${r.desc}${activeRole === r.name ? "  ← 当前" : ""}`,
      ),
      `关闭注入${activeRole ? "" : "  ← 当前"}`,
      `拦截器：${interceptEnabled ? "开启" : "关闭"}${
        activeRole ? "" : "（角色模式下才生效）"
      }`,
      "查看状态",
    ];
    try {
      if (!ctx.hasUI) {
        notify(
          ctx,
          "交互式菜单仅支持交互界面（TUI）；请用 /role <name> 或 pi --role <name> 旗标",
          "warning",
        );
        return;
      }
      const picked = await ctx.ui.select("pi-roles 角色", menuItems);
      if (picked === undefined) return; // Esc 取消，不做任何变更
      const index = menuItems.indexOf(picked);
      if (index >= 0 && index < roles.length) {
        activeRole = roles[index].name;
        persistState();
        applyStatus(ctx);
        notify(ctx, `✅ 角色「${roles[index].name}」已启用（${modeLabel()}）`);
      } else if (index === roles.length) {
        activeRole = null;
        persistState();
        applyStatus(ctx);
        notify(ctx, "注入已关闭（拦截随角色模式停用）");
      } else if (index === roles.length + 1) {
        interceptEnabled = !interceptEnabled;
        persistState();
        notify(
          ctx,
          interceptEnabled
            ? "✅ 拦截器已开启（仅角色模式下生效）"
            : "拦截器已关闭（角色模式下也不再拦截）",
        );
      } else {
        notify(ctx, statusText());
      }
    } catch {
      notify(ctx, "菜单不可用，已取消（未做任何变更）", "warning");
    }
  };

  pi.registerCommand("role", {
    description: "pi-roles: 角色模板系统菜单与切换（/role <name> [replace|append]）",
    handler: roleMenuHandler,
  });

  // /ctf = /role 别名（兼容旧习惯）
  pi.registerCommand("ctf", {
    description: "pi-roles: /role 的别名（角色菜单）",
    handler: roleMenuHandler,
  });

  // ─── 会话启动: 恢复状态 + 读取共享配置 ────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    config = loadCspConfig();
    activeRole = null;
    interceptEnabled = true;
    injectionMode = "replace";
    intercepted = 0;

    // 从会话 custom entry 恢复（兼容旧版 ctfEnabled 字段：true → ctf 角色）
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
            }
          | undefined;
        if (!data) continue;
        if (typeof data.role === "string" && hasRole(data.role))
          activeRole = data.role;
        if (
          typeof data.ctfEnabled === "boolean" &&
          data.ctfEnabled &&
          !activeRole
        ) {
          activeRole = "ctf"; // 旧条目兼容：ctfEnabled=true → ctf 角色
        }
        if (typeof data.interceptEnabled === "boolean")
          interceptEnabled = data.interceptEnabled;
        if (isInjectionMode(data.injectionMode))
          injectionMode = data.injectionMode;
      }
    } catch {
      // 状态恢复失败按默认值处理
    }

    // CLI 旗标强制开启并持久化（显式敲旗标 = 明确要求，优先于持久化状态）
    // 兼容旧旗标：--ctf（追加）/ --ctfa（追加）/ --ctfr（替换）→ ctf 角色
    try {
      const ctfr = pi.getFlag("ctfr") === true;
      const ctfa = pi.getFlag("ctfa") === true;
      let reqRole: string | null = null;
      let reqMode: InjectionMode | null = null;
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
        if (!reqMode) reqMode = "replace";
      }
      if (typeof roleAppendFlag === "string" && roleAppendFlag.trim()) {
        reqRole = roleAppendFlag.trim();
        reqMode = "append";
      }
      const flagMode = pi.getFlag("role-mode") ?? pi.getFlag("ctf-mode");
      if (isInjectionMode(flagMode)) reqMode = flagMode;
      if (reqRole && hasRole(reqRole)) {
        if (activeRole !== reqRole || (reqMode && injectionMode !== reqMode)) {
          activeRole = reqRole;
          if (reqMode) injectionMode = reqMode;
          persistState();
        }
      }
    } catch {
      // 旗标读取失败按未启用处理
    }

    applyStatus(ctx);
  });

  // ─── 角色提示词注入 ──────────────────────────────────────────────────────

  pi.on("before_agent_start", async (event) => {
    if (!activeRole) return undefined;
    const prompt = getRolePrompt(activeRole);
    if (injectionMode === "replace") {
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

  // ─── 实时拒绝拦截（随角色模式联动：仅注入开启时生效） ──────────────────────

  pi.on("message_end", async (event, ctx) => {
    // 拦截只在角色（CTF）模式开启时自动生效；其他模式一律不拦截
    if (!interceptEnabled || !activeRole) return undefined;

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
      `🛡 ${PACKAGE_MARKER}: 已拦截 1 条拒绝回复并替换为配合性内容（本会话累计 ${intercepted} 条；/role 菜单可关闭拦截器）`,
      "warning",
    );
    return { message: replaced };
  });
}
