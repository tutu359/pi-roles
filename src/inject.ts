/**
 * 角色提示词注入 —— 把角色模板送进本次运行的系统提示词。
 *
 * 两种模式的语义差别：
 * - replace：只换「内置默认剧本」（身份 + `<tools>` + `<rules>` + `<docs>`）。
 *   事实层（`<project_context>` / `<skills>` / `<cwd>` / 用户追加内容）由 pi 自动接上，
 *   不手工重建 —— 既不会随 pi 改格式而漂移，也保持结构化分段（无需整体强制替换）。
 * - append：在现有系统提示词后追加，默认剧本原样保留。
 *
 * 这两个模式只决定「模板怎么进去」，与角色内容、拦截开关无关。
 */
import type { InjectionMode } from "./state.ts";

/** 注入所需的最小提示词上下文（对齐 pi 的 BeforeAgentStartEvent） */
export interface PromptContextLike {
  systemPrompt: string;
  systemPromptOptions?: { customPrompt?: string };
}

/** pi 的 before_agent_start 返回值：只有 append 需要显式给出 systemPrompt */
export interface PromptPatch {
  systemPrompt: string;
}

/**
 * 计算本次运行的系统提示词补丁。
 *
 * replace 走 `systemPromptOptions.customPrompt`（pi 原生 `--system-prompt` 语义），
 * 返回 undefined 表示「不改最终字符串，只改默认剧本」，其余由 pi 拼装。
 */
export function applyRolePrompt(
  ctx: PromptContextLike,
  mode: InjectionMode,
  prompt: string,
): PromptPatch | undefined {
  if (mode === "replace") {
    const opts = ctx.systemPromptOptions;
    // 旧版 pi 没有 options：退化为整体替换（会丢事实层，但角色至少生效）
    if (!opts) return { systemPrompt: prompt };
    opts.customPrompt = prompt;
    return undefined;
  }
  return { systemPrompt: `${ctx.systemPrompt}\n\n${prompt}` };
}
