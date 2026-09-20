/**
 * pi-ctf — 提示词替换扩展（从 pi-session-patcher fork 独立）
 *
 * 定位：以「提示词替换」为主 —— replace 模式用 CTF/渗透测试工作流提示词替换
 * pi 内置默认剧本（保留 AGENTS.md 与 skill 清单），适合主会话强 CTF 场景。
 * 提示词追加（append 模式）留给「委派」：子代理 fork 父会话上下文时，在完整
 * 原生剧本末尾追加 CTF 提示词，不破坏子代理已有能力。
 *
 * 附带能力：实时拒绝拦截（会话清理的事前版）
 *    助手消息定稿时（message_end）检测拒绝回复，命中则将文本替换为配合性内容，
 *    让会话历史保持干净，避免「拒绝记忆」污染后续 resume / 续聊。
 *    事后批量清理历史会话仍由上游 codex-session-patcher Web UI 负责。
 *
 * 可选松耦合：本机存在 ~/.codex-patcher/config.json 时，读取
 * mock_response（兜底文本）、custom_keywords（自定义检测词）、
 * ctf_prompts.pi.prompt（自定义 CTF 模板）。不安装主工具也完整可用。
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
  CTF_PROMPT_MARKER,
  DEFAULT_CTF_PROMPT,
  FALLBACK_RESPONSE,
  isMojibake,
} from "./src/prompts.ts";
import {
  CSP_CONFIG_PATH,
  loadCspConfig,
  type CspConfig,
} from "./src/config.ts";

/** 会话内状态持久化使用的 custom entry 类型 */
const STATE_ENTRY_TYPE = "csp-ctf-state";

/** 状态条标识 */
const STATUS_KEY = "csp-ctf";

/** 事件与命令处理器共用的最小 UI 上下文（ExtensionContext / ExtensionCommandContext 均可赋值） */
type UiCtx = Pick<ExtensionContext, "hasUI" | "ui">;

/** 注入模式：replace 完全替换系统提示词（默认，主会话强 CTF）；append 在现有系统提示词后追加（委派子代理场景） */
type InjectionMode = "append" | "replace";

function isInjectionMode(value: unknown): value is InjectionMode {
  return value === "append" || value === "replace";
}

export default function cspPiExtension(pi: ExtensionAPI) {
  // ── 会话内状态 ──────────────────────────────────────────────────────────
  let ctfEnabled = false; // CTF 提示词注入开关（按会话持久化）
  let interceptEnabled = true; // 实时拒绝拦截开关（按会话持久化）
  let injectionMode: InjectionMode = "replace"; // 注入模式：replace 替换（默认，主要作用）/ append 追加（委派用，按会话持久化）
  let intercepted = 0; // 本会话拦截计数
  let config: CspConfig = { customKeywords: [], configFound: false };

  // ─── 工具函数 ───────────────────────────────────────────────────────────

  function getCtfPrompt(): string {
    const custom = config.ctfPrompt?.trim();
    return custom ? custom : DEFAULT_CTF_PROMPT;
  }

  function getCtfPromptSource(): string {
    return config.ctfPrompt
      ? "自定义 (~/.codex-patcher/config.json)"
      : "内置模板";
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
      ctx?.ui?.setStatus?.(STATUS_KEY, ctfEnabled ? "CTF" : undefined);
    } catch {
      // 状态条不可用时忽略
    }
  }

  function persistState(): void {
    try {
      pi.appendEntry(STATE_ENTRY_TYPE, {
        ctfEnabled,
        interceptEnabled,
        injectionMode,
      });
    } catch {
      // 持久化失败只影响 resume 恢复，不影响本次会话
    }
  }

  function modeLabel(): string {
    return injectionMode === "replace"
      ? "replace（完全替换系统提示词）"
      : "append（追加，默认）";
  }

  function statusText(): string {
    return [
      "pi-ctf (提示词替换 · 从 pi-session-patcher fork)",
      `· CTF 提示词注入: ${ctfEnabled ? "✅ 开启" : "关闭"} — 模式: ${modeLabel()} — 模板: ${getCtfPromptSource()}`,
      `· 实时拒绝拦截: ${interceptEnabled ? "✅ 开启" : "关闭"} — 本会话已拦截 ${intercepted} 条`,
      `· 兜底替换文本: ${config.mockResponse ? "~/.codex-patcher/config.json" : "内置默认"}`,
      `· 共享配置: ${config.configFound ? CSP_CONFIG_PATH : "未找到（使用内置默认）"}`,
      `· 注入标记: ${CTF_PROMPT_MARKER}`,
    ].join("\n");
  }

  // ─── 命令行旗标: pi --ctf ────────────────────────────────────────────────

  pi.registerFlag("ctf", {
    description: "以 CTF 模式启动（每轮注入安全测试系统提示词）",
    type: "boolean",
    default: false,
  });

  // 字符串旗标不设 default：未传时 getFlag 返回 undefined，避免 resume 时把
  // 会话内持久化的 replace 模式误重置回 append。
  pi.registerFlag("ctf-mode", {
    description:
      "CTF 注入模式：replace 替换系统提示词（默认，主要作用）/ append 追加（委派场景）",
    type: "string",
  });

  // --ctfr：--ctf --ctf-mode replace 的组合短旗标（强 CTF 一条命令直启）
  pi.registerFlag("ctfr", {
    description: "以 CTF 替换模式启动（等价 --ctf --ctf-mode replace）",
    type: "boolean",
    default: false,
  });

  // --ctfa：显式追加模式启动（与 --ctf 等效，使命名对称好记）
  pi.registerFlag("ctfa", {
    description: "以 CTF 追加模式启动（等价 --ctf）",
    type: "boolean",
    default: false,
  });

  // ─── 命令: /ctf ──────────────────────────────────────────────────

  pi.registerCommand("ctf", {
    description: "pi-ctf: 提示词替换 / 追加注入与拦截器菜单",
    handler: async (_args, ctx) => {
      // /ctf = 交互式菜单；只标注真正生效的选项（注入关闭时模式标签无意义，不标）
      const menuItems = [
        `替换模式${ctfEnabled && injectionMode === "replace" ? "  ← 当前" : ""}`,
        `追加模式${ctfEnabled && injectionMode === "append" ? "  ← 当前" : ""}`,
        `关闭注入${ctfEnabled ? "" : "  ← 当前"}`,
        `拦截器：${interceptEnabled ? "开启" : "关闭"}`,
        "查看状态",
      ];
      try {
        if (!ctx.hasUI) {
          notify(
            ctx,
            "交互式菜单仅支持交互界面（TUI）；脚本环境请用 pi --ctf / --ctfr 旗标",
            "warning",
          );
          return;
        }
        const picked = await ctx.ui.select("CTF 模式", menuItems);
        if (picked === undefined) return; // Esc 取消，不做任何变更
        const index = menuItems.indexOf(picked);
        if (index === 0) {
          injectionMode = "replace";
          ctfEnabled = true;
        } else if (index === 1) {
          injectionMode = "append";
          ctfEnabled = true;
        } else if (index === 2) {
          ctfEnabled = false;
        } else if (index === 3) {
          interceptEnabled = !interceptEnabled;
        } else {
          notify(ctx, statusText());
          return;
        }
        persistState();
        applyStatus(ctx);
        if (index === 3) {
          notify(
            ctx,
            interceptEnabled
              ? "✅ 拦截器已开启：拒绝回复将在落盘前被替换为配合性内容"
              : "拦截器已关闭：拒绝回复将原样写入会话",
          );
          return;
        }
        if (ctfEnabled) {
          notify(
            ctx,
            injectionMode === "replace"
              ? "✅ 替换模式已开启（主要作用）：以 CTF 提示词替换 pi 内置默认剧本（你的 AGENTS.md 与 skill 清单仍保留）"
              : "✅ 追加模式已开启（委派场景）：在现有系统提示词末尾追加 CTF 提示词",
            injectionMode === "replace" ? "warning" : "info",
          );
        } else {
          notify(ctx, "CTF 注入已关闭");
        }
      } catch {
        notify(ctx, "菜单不可用，已取消（未做任何变更）", "warning");
      }
    },
  });

  // ─── 会话启动: 恢复状态 + 读取共享配置 ────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    config = loadCspConfig();
    ctfEnabled = false;
    interceptEnabled = true;
    injectionMode = "replace";
    intercepted = 0;

    // 从会话 custom entry 恢复开关状态（取最后一条；旧条目缺 injectionMode 时安全回退 append）
    try {
      for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type !== "custom") continue;
        if (entry.customType !== STATE_ENTRY_TYPE) continue;
        const data = entry.data as
          | {
              ctfEnabled?: unknown;
              interceptEnabled?: unknown;
              injectionMode?: unknown;
            }
          | undefined;
        if (!data) continue;
        if (typeof data.ctfEnabled === "boolean") ctfEnabled = data.ctfEnabled;
        if (typeof data.interceptEnabled === "boolean")
          interceptEnabled = data.interceptEnabled;
        if (isInjectionMode(data.injectionMode))
          injectionMode = data.injectionMode;
      }
    } catch {
      // 状态恢复失败按默认值处理
    }

    // CLI 旗标强制开启并持久化（等价 codex -p ctf 的工作流）
    // 三条启动命令：--ctf（追加，默认）/ --ctfa（追加）/ --ctfr（替换）
    try {
      const ctfr = pi.getFlag("ctfr") === true;
      const ctfa = pi.getFlag("ctfa") === true;
      if (ctfr) {
        if (!ctfEnabled || injectionMode !== "replace") {
          ctfEnabled = true;
          injectionMode = "replace";
          persistState();
        }
      } else if ((ctfa || pi.getFlag("ctf")) && !ctfEnabled) {
        ctfEnabled = true;
        injectionMode = "append";
        persistState();
      }
      const flagMode = pi.getFlag("ctf-mode");
      if (isInjectionMode(flagMode) && flagMode !== injectionMode) {
        injectionMode = flagMode;
        persistState();
      }
    } catch {
      // 旗标读取失败按未启用处理
    }

    applyStatus(ctx);
  });

  // ─── CTF 提示词注入 ──────────────────────────────────────────────────────

  pi.on("before_agent_start", async (event) => {
    if (!ctfEnabled) return undefined;
    const prompt = getCtfPrompt();
    if (injectionMode === "replace") {
      // 替换模式：以 CTF 提示词为基底，但保留 AGENTS.md 等上下文文件与 skill 清单
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

  // ─── 实时拒绝拦截 ────────────────────────────────────────────────────────

  pi.on("message_end", async (event, ctx) => {
    if (!interceptEnabled) return undefined;

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
      `🛡 pi-ctf: 已拦截 1 条拒绝回复并替换为配合性内容（本会话累计 ${intercepted} 条；/ctf intercept off 可关闭）`,
      "warning",
    );
    return { message: replaced };
  });
}
