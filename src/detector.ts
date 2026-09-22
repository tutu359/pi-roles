/**
 * 拒绝内容检测器
 *
 * 关键词表在仓库根目录的 keywords.txt 里维护（本文件不写死词表）：
 * 1. [全文] 段：关键词出现在任意位置即判定
 * 2. [开头] 段：关键词仅在消息开头 150 字符内出现才判定（避免正文里顺口提一句就误伤）
 *
 * keywords.txt 缺失时回退到最小应急词表（EMERGENCY_KEYWORDS），避免功能静默失效。
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 开头匹配段的位置限制（字符数） */
export const HEAD_LIMIT = 150;

/** 关键词集合（从 keywords.txt 解析而来） */
export interface RefusalKeywords {
  /** 全文任意位置命中即判定 */
  strong: string[];
  /** 仅在开头 HEAD_LIMIT 字符内命中才判定 */
  weak: string[];
}

/** keywords.txt 缺失（或读取失败）时的最小应急词表，避免拦截静默失效 */
const EMERGENCY_KEYWORDS: RefusalKeywords = {
  strong: [
    "i cannot assist",
    "i can't assist",
    "i cannot help",
    "i must refuse",
    "as a language model",
  ],
  weak: [],
};

/** 解析关键词表文本：段落标记之前的词默认归入 [全文] */
export function parseKeywords(raw: string): RefusalKeywords {
  const strong: string[] = [];
  const weak: string[] = [];
  let target: "strong" | "weak" = "strong";

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const section = line.match(/^\[(.+?)\]$/);
    if (section) {
      target = section[1].includes("开头") ? "weak" : "strong";
      continue;
    }
    if (target === "weak") weak.push(line);
    else strong.push(line);
  }
  return { strong, weak };
}

/** keywords.txt 路径（与 src/ 平级） */
function keywordsPath(): string | null {
  try {
    const url = import.meta.url;
    if (typeof url === "string" && url.startsWith("file:")) {
      return join(dirname(fileURLToPath(url)), "..", "keywords.txt");
    }
  } catch {
    // jiti 变换环境下可能不可用
  }
  return null;
}

let cache: { mtimeMs: number; keywords: RefusalKeywords } | null = null;

/** 加载关键词表（按 mtime 缓存，改文件后无需重启即可生效） */
export function loadKeywords(): RefusalKeywords {
  const path = keywordsPath();
  if (!path) return EMERGENCY_KEYWORDS;
  try {
    const stat = statSync(path);
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.keywords;
    const keywords = parseKeywords(readFileSync(path, "utf8"));
    cache = { mtimeMs: stat.mtimeMs, keywords };
    return keywords;
  } catch {
    return EMERGENCY_KEYWORDS;
  }
}

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
 * 检测内容是否为拒绝回复（findRefusalMatch 的布尔包装）。
 * keywords 默认从 keywords.txt 加载；测试可显式传入以保持确定性。
 */
export function detectRefusal(
  content: string,
  keywords: RefusalKeywords = loadKeywords(),
): boolean {
  return findRefusalMatch(content, keywords) !== null;
}

/** 命中的拒绝词及其所在段（用于告知“为什么被拦”） */
export interface RefusalMatch {
  keyword: string;
  tier: "全文" | "开头";
}

/**
 * 查找命中的拒绝词；未命中返回 null。
 * 与 detectRefusal 同一套规则（先全文段，再开头段）。
 */
export function findRefusalMatch(
  content: string,
  keywords: RefusalKeywords = loadKeywords(),
): RefusalMatch | null {
  if (!content) return null;

  const contentLower = content.toLowerCase();

  // 1. 全文段：任意位置命中即判定
  for (const phrase of keywords.strong) {
    if (phrase && contentLower.includes(phrase.toLowerCase())) {
      return { keyword: phrase, tier: "全文" };
    }
  }

  // 2. 开头段：仅匹配消息开头 HEAD_LIMIT 字符
  const head = contentLower.slice(0, HEAD_LIMIT);
  for (const keyword of keywords.weak) {
    if (keyword && head.includes(keyword.toLowerCase())) {
      return { keyword, tier: "开头" };
    }
  }

  return null;
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
