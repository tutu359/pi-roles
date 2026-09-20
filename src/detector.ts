/**
 * 拒绝内容检测器 — 移植自 codex-session-patcher/core/detector.py
 *
 * 两级检测策略：
 * 1. 强拒绝短语：出现在任意位置即判定（误报率低）
 * 2. 弱拒绝关键词：仅在消息开头 150 字符内出现才判定
 * 3. 自定义关键词（可选）：全文匹配，作为强匹配处理
 */

/** 强拒绝短语：全文任意位置命中即判定为拒绝 */
export const STRONG_REFUSAL_PHRASES: readonly string[] = [
  // 中文
  "我无法协助",
  "我无法帮助",
  "我不能协助",
  "我不能帮助",
  "我不能做",
  "我无法做",
  "我不会帮",
  "我无法提供",
  "违反了我的",
  "违反我的",
  "这违反",
  "我拒绝",
  "我必须拒绝",
  // 英文
  "i cannot assist",
  "i can't assist",
  "i'm unable to assist",
  "i cannot help",
  "i can't help",
  "i'm unable to help",
  "i must decline",
  "i must refuse",
  "against my guidelines",
  "against my policy",
  "violates my",
  "i won't help",
  "i won't assist",
  "as an ai",
  "as a language model",
  "i apologize, but i",
  "i'm sorry, but i can't",
  "not able to provide",
  "not able to assist",
];

/** 弱拒绝关键词：需要出现在消息开头（前 150 字符）才算拒绝 */
export const WEAK_REFUSAL_KEYWORDS: readonly string[] = [
  // 中文
  "抱歉",
  "很抱歉",
  "对不起",
  "不好意思",
  "我无法",
  "我不能",
  "不允许",
  "禁止",
  // 中文 - 省略主语的直接拒绝
  "不能帮你",
  "不能协助",
  "无法帮你",
  "无法协助你",
  "不会帮你",
  "不会帮助",
  "不能为你",
  "无法为你",
  // 英文
  "sorry",
  "apologize",
  "i cannot",
  "i can't",
  "i'm unable",
  "unable to",
  "not permitted",
  "not allowed",
  "refuse to",
];

/** pi 会话消息的内容块（结构化子集，避免依赖具体类型导出） */
export interface ContentBlock {
  type: string;
  text?: string;
}

/** pi AssistantMessage 的结构化子集 */
export interface AssistantMessageLike {
  role: string;
  content: string | ContentBlock[];
}

/**
 * 检测内容是否为拒绝回复。
 * 返回 true 表示命中（强短语 / 开头弱词 / 自定义关键词）。
 */
export function detectRefusal(
  content: string,
  customKeywords: readonly string[] = [],
): boolean {
  if (!content) return false;

  const contentLower = content.toLowerCase();

  // 1. 强拒绝短语 - 全文匹配
  for (const phrase of STRONG_REFUSAL_PHRASES) {
    if (contentLower.includes(phrase)) return true;
  }

  // 2. 弱拒绝关键词 - 仅匹配开头 150 字符
  const head = contentLower.slice(0, 150);
  for (const keyword of WEAK_REFUSAL_KEYWORDS) {
    if (head.includes(keyword)) return true;
  }

  // 3. 用户自定义关键词 - 全文匹配
  for (const keyword of customKeywords) {
    if (keyword && contentLower.includes(keyword.toLowerCase())) return true;
  }

  return false;
}

/** 从 assistant 消息中提取全部 text 块文本（用换行拼接） */
export function extractAssistantText(message: AssistantMessageLike): string {
  const { content } = message;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const block of content) {
    if (block && block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
    }
  }
  return texts.join("\n");
}

/**
 * 替换 assistant 消息中的文本内容：
 * 第一个 text 块替换为 newText，其余 text 块移除（保证无拒绝文本残留），
 * thinking / toolCall 等其他块原样保留。
 * 泛型保持入参的具体消息类型（如 pi-ai 的 AssistantMessage），返回新对象（不修改入参）。
 */
export function replaceAssistantTextBlocks<T extends AssistantMessageLike>(
  message: T,
  newText: string,
): T {
  const content = message.content;
  if (typeof content === "string") {
    // SAFETY: 泛型 T 即调用方的真实消息类型；重建的 content 为单 text 块，
    // 运行时形状与 T 的 content 约定一致，TS 无法从字面量证明。
    return {
      ...message,
      content: [{ type: "text", text: newText }],
    } as unknown as T;
  }
  if (!Array.isArray(content)) {
    // SAFETY: 同上 —— 重建 content 与 T 的运行时形状一致，仅类型层面不可证。
    return {
      ...message,
      content: [{ type: "text", text: newText }],
    } as unknown as T;
  }

  let replaced = false;
  const next: ContentBlock[] = [];
  for (const block of content) {
    if (block && block.type === "text") {
      if (!replaced) {
        next.push({ ...block, text: newText });
        replaced = true;
      }
      // 丢弃后续 text 块，避免拒绝文本残留
      continue;
    }
    next.push(block);
  }
  if (!replaced) {
    next.push({ type: "text", text: newText });
  }
  // SAFETY: next 中保留了除 text 外的全部原始块，并把 text 块归一为单块，
  // 运行时仍是 T 的合法 content 形状；结构化子集与具体消息类型间的差异 TS 无法证明。
  return { ...message, content: next } as unknown as T;
}
