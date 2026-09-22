/**
 * pi-roles — 角色模板系统（从 pi-session-patcher fork 独立）
 *
 * 以「角色」为单位管理提示词模板：一个角色 = roles/<name>.md 一个文件，
 * 放目录即自动出现在角色子菜单，添加角色零代码。
 *
 * 交互：/role 菜单（外层主菜单：追加/替换模式、自动拦截 → 角色子菜单：选择具体角色）。
 * 启动旗标方案待定（暂未注册）。
 *
 * 注入模式：
 * - append（默认）：在现有系统提示词末尾追加角色模板（保留原生剧本），委派子代理场景
 * - replace：用角色模板替换 pi 内置默认剧本（保留 AGENTS.md 与 skill 清单），主会话强场景
 *
 * 附带能力：实时拒绝拦截（会话清理的事前版）。拦截开关默认关闭，选中角色时自动开启，
 * 且仅在开关开启且已选角色时生效。助手消息定稿时检测拒绝回复，命中则替换为内置兜底文本，
 * 避免「拒绝记忆」污染后续 resume / 续聊。
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  extractAssistantText,
  findRefusalMatch,
  replaceAssistantTextBlocks,
} from "./src/detector.ts";
import {
  FALLBACK_RESPONSE,
  listRoles,
  getRoleContent,
  hasRole,
} from "./src/prompts.ts";
import {
  applyRoleState,
  defaultRoleState,
  interceptActive,
  isInjectionMode,
  type RoleState,
} from "./src/state.ts";

/** 会话内状态持久化使用的 custom entry 类型 */
const STATE_ENTRY_TYPE = "pi-roles-state";

/** 状态条标识 */
const STATUS_KEY = "pi-roles";

/** 拦截记录条目类型（渲染在聊天记录里，不进入 LLM 上下文） */
const INTERCEPT_ENTRY_TYPE = "pi-roles-intercept";

/** 拦截记录内容 */
interface InterceptRecord {
  /** 命中的词 */
  keyword: string;
  /** 命中所在段（全文 / 开头） */
  tier: string;
  /** 当时的角色 */
  role: string | null;
  /** 被替换掉的完整原文 */
  original: string;
}

/** 取文本单行预览（折叠空白 + 截断） */
function previewOf(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(oneLine);
  return chars.length > max ? chars.slice(0, max).join("") + "…" : oneLine;
}

/** 事件与命令处理器共用的最小 UI 上下文（ExtensionContext / ExtensionCommandContext 均可赋值） */
type UiCtx = Pick<ExtensionContext, "hasUI" | "ui">;

export default function piRolesExtension(pi: ExtensionAPI) {
  // ── 会话内状态（默认：无角色 · 追加模式 · 自动拦截关闭） ───────────────────
  let state: RoleState = defaultRoleState();
  let intercepted = 0; // 本会话拦截计数
  let menuChanged = false; // 本次菜单会话是否改动过（决定 Esc 退出时是否报结果）

  // 拦截记录渲染：显示在聊天记录里（不进 LLM 上下文），展开可看完整原文
  pi.registerEntryRenderer<InterceptRecord>(
    INTERCEPT_ENTRY_TYPE,
    (entry, { expanded }, theme) => {
      const data = entry.data;
      if (!data) return undefined;
      const { keyword, tier, role, original } = data;
      const header = theme.fg(
        "warning",
        `🛡 已自动拦截 · 命中「${keyword}」（${tier}匹配）${
          role ? ` · 角色 ${role}` : ""
        }`,
      );
      const body = expanded
        ? original.split("\n").map((line: string) => theme.fg("dim", `   │ ${line}`))
        : [theme.fg("dim", `   │ 原文：${previewOf(original)}`)];
      const lines = [header, ...body];
      return {
        render: () => lines,
        invalidate: () => {},
      };
    },
  );

  // ─── 工具函数 ───────────────────────────────────────────────────────────

  /** 取角色模板内容（加载失败时回退精简兜底模板） */
  function getRolePrompt(name: string): string {
    return getRoleContent(name);
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

  /**
   * 状态栏文本：`[ctf]·replace·🛡`
   * 配色：方括号/分隔点 dim（最淡）→ 模式 muted（中间调）→ 角色名 accent（主题高亮）
   * 用主题色而非硬编码颜色，换浅色/深色主题时自动适配；🛡 为 emoji，颜色由终端决定。
   * 无角色时返回 undefined（清空状态栏）。
   */
  function statusLine(ctx: UiCtx): string | undefined {
    if (!state.role) return undefined;
    const theme = ctx?.ui?.theme;
    const paint = (color: "dim" | "accent" | "muted", text: string): string => {
      if (!theme) return text;
      try {
        return theme.fg(color, text);
      } catch {
        return text; // 未知颜色名等异常时回退为纯文本
      }
    };
    let out = `${paint("dim", "[")}${paint("accent", state.role)}${paint("dim", "]")}`;
    out += `${paint("dim", "·")}${paint("muted", state.mode)}`;
    if (state.intercept) out += `${paint("dim", "·")}🛡`;
    return out;
  }

  function applyStatus(ctx: UiCtx): void {
    try {
      ctx?.ui?.setStatus?.(STATUS_KEY, statusLine(ctx));
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

  // ─── 菜单 ───────────────────────────────────────────────────────────────

  /** 菜单退出时的结果摘要（此时所有选择已确定，不会过期） */
  function menuSummary(): string {
    if (!state.role) return "未启用角色";
    return `已启用 ${state.role} · ${state.mode} · 自动拦截${
      state.intercept ? "开" : "关"
    }`;
  }

  /** 截断描述文本（按字符计，超长加省略号） */
  function truncateDesc(text: string, max = 40): string {
    const chars = Array.from(text);
    return chars.length > max ? chars.slice(0, max).join("") + "…" : text;
  }

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
    const maxNameLen = Math.max(...roles.map((r) => r.name.length));
    const items = roles.map((r) => {
      const pad = " ".repeat(Math.max(2, maxNameLen - r.name.length + 2));
      const current = state.role === r.name ? "  ← 当前" : "";
      return `${r.name}${pad}${truncateDesc(r.desc)}${current}`;
    });
    items.push("返回");
    try {
      const picked = await ctx.ui.select("选择角色", items);
      if (picked === undefined) return; // Esc 返回主菜单
      const idx = items.indexOf(picked);
      if (idx === items.length - 1) return; // 返回主菜单
      const role = roles[idx];
      state = applyRoleState(state, { type: "selectRole", role: role.name });
      persistState();
      applyStatus(ctx);
      menuChanged = true;
      // 返回主菜单，便于继续调整模式/拦截
    } catch {
      notify(ctx, "菜单不可用，已取消（未做任何变更）", "warning");
    }
  }

  /** 外层主菜单：角色入口 + 模式单选 + 自动拦截；Esc 退出时统一报一次结果 */
  async function mainMenu(ctx: UiCtx): Promise<void> {
    menuChanged = false;
    for (;;) {
      const label = (name: string, value = ""): string =>
        value ? `${name}  ${value}` : name;
      const items = [
        label("选择角色", state.role ?? ""),
        label("追加模式", state.mode === "append" ? "← 当前" : ""),
        label("替换模式", state.mode === "replace" ? "← 当前" : ""),
        label("自动拦截", state.intercept ? "开启" : "关闭"),
      ];
      let picked: string | undefined;
      try {
        picked = await ctx.ui.select("pi-roles", items);
      } catch {
        notify(ctx, "菜单不可用，已取消（未做任何变更）", "warning");
        return;
      }
      if (picked === undefined) {
        // Esc 退出：改动过才报一次最终状态（没改就不打扰）
        if (menuChanged) notify(ctx, menuSummary());
        return;
      }
      const idx = items.indexOf(picked);
      if (idx === 0) {
        await roleSubMenu(ctx);
      } else if (idx === 1) {
        state = applyRoleState(state, { type: "setMode", mode: "append" });
        persistState();
        applyStatus(ctx);
        menuChanged = true;
      } else if (idx === 2) {
        state = applyRoleState(state, { type: "setMode", mode: "replace" });
        persistState();
        applyStatus(ctx);
        menuChanged = true;
      } else if (idx === 3) {
        state = applyRoleState(state, { type: "toggleIntercept" });
        persistState();
        applyStatus(ctx);
        menuChanged = true;
      }
    }
  }

  // ─── 命令: /role ────────────────────────────────────────────────────────

  const roleMenuHandler = async (args: unknown, ctx: UiCtx): Promise<void> => {
    const argText = typeof args === "string" ? args.trim() : "";
    if (argText) {
      // 会话内直切暂不支持（交互收敛为 /role 菜单）
      notify(
        ctx,
        "会话内请用 /role 菜单选择角色",
        "info",
      );
      return;
    }
    if (!ctx.hasUI) {
      notify(
        ctx,
        "无交互界面，菜单不可用",
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

  // ─── 会话启动: 恢复状态 ─────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
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

    const fallback = FALLBACK_RESPONSE;
    if (text.trim() === fallback.trim()) return undefined; // 已是兜底文本，避免重复处理

    const match = findRefusalMatch(text);
    if (!match) return undefined;

    const replaced = replaceAssistantTextBlocks(message, fallback);
    intercepted += 1;

    // 落一条拦截记录：渲染在聊天记录里（不进 LLM 上下文），展开可看完整原文
    try {
      pi.appendEntry<InterceptRecord>(INTERCEPT_ENTRY_TYPE, {
        keyword: match.keyword,
        tier: match.tier,
        role: state.role,
        original: text,
      });
    } catch {
      // 记录失败不影响拦截本身
    }

    notify(
      ctx,
      `🛡 已拦截 · 命中「${match.keyword}」（${match.tier}匹配）`,
      "warning",
    );
    return { message: replaced };
  });
}
