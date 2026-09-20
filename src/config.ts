/**
 * 可选松耦合：读取 codex-session-patcher 共享配置 ~/.codex-patcher/config.json
 *
 * 没有安装 codex-session-patcher 时本扩展照常工作（全部回退到内置默认值）；
 * 安装后在 Web UI 里保存的自定义模板 / 兜底回复 / 自定义关键词对 pi 同样生效。
 */
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isMojibake } from "./prompts.ts";

/** 共享配置文件路径（与 CLI / Web UI 相同） */
export const CSP_CONFIG_PATH = join(homedir(), ".codex-patcher", "config.json");

export interface CspConfig {
  /** 兜底替换文本（config.json 的 mock_response） */
  mockResponse?: string;
  /** 自定义拒绝检测关键词（custom_keywords 各语言扁平化合并） */
  customKeywords: string[];
  /** 自定义 CTF 提示词（ctf_prompts.pi.prompt） */
  ctfPrompt?: string;
  /** 配置文件是否存在且可读 */
  configFound: boolean;
}

const EMPTY_CONFIG: CspConfig = { customKeywords: [], configFound: false };

let cache: { mtimeMs: number; config: CspConfig } | null = null;

/** 读取共享配置；文件缺失 / JSON 损坏时返回空配置（静默降级） */
export function loadCspConfig(): CspConfig {
  try {
    const stat = statSync(CSP_CONFIG_PATH);
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.config;

    const raw = JSON.parse(readFileSync(CSP_CONFIG_PATH, "utf8")) as Record<
      string,
      unknown
    >;
    const config: CspConfig = { customKeywords: [], configFound: true };

    // 兜底替换文本：空值或问号乱码时忽略，使用内置默认
    const mock = raw.mock_response;
    if (typeof mock === "string" && mock.trim() && !isMojibake(mock)) {
      config.mockResponse = mock;
    }

    // 自定义拒绝检测关键词：{ zh: [...], en: [...], ... } 扁平化
    const keywords = raw.custom_keywords;
    if (keywords && typeof keywords === "object" && !Array.isArray(keywords)) {
      for (const list of Object.values(keywords as Record<string, unknown>)) {
        if (Array.isArray(list)) {
          for (const word of list) {
            if (typeof word === "string" && word.trim())
              config.customKeywords.push(word);
          }
        }
      }
    }

    // 自定义 CTF 提示词：ctf_prompts["pi"].prompt
    const prompts = raw.ctf_prompts;
    if (prompts && typeof prompts === "object" && !Array.isArray(prompts)) {
      const piEntry = (prompts as Record<string, unknown>)["pi"];
      if (piEntry && typeof piEntry === "object") {
        const prompt = (piEntry as Record<string, unknown>).prompt;
        if (typeof prompt === "string" && prompt.trim())
          config.ctfPrompt = prompt;
      }
    }

    cache = { mtimeMs: stat.mtimeMs, config };
    return config;
  } catch {
    return { ...EMPTY_CONFIG, customKeywords: [] };
  }
}
