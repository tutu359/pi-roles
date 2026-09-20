/**
 * pi-ctf 单元测试 — 拒绝检测 / 文本提取 / 替换（node --experimental-strip-types 直接运行）
 *
 * 运行：npm test
 */
import assert from "node:assert/strict";
import {
  detectRefusal,
  extractAssistantText,
  replaceAssistantTextBlocks,
  type AssistantMessageLike,
} from "../src/detector.ts";
import { isMojibake } from "../src/prompts.ts";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("pi-ctf detector / prompts 测试\n");

// ── detectRefusal：强拒绝短语（全文任意位置） ──────────────────────────
check("强短语：我无法协助（任意位置）", () => {
  assert.equal(detectRefusal("不好意思，我无法协助完成该请求。"), true);
  assert.equal(detectRefusal("先说明一下，我无法提供任何帮助。"), true);
});
check("强短语：I cannot assist（任意位置，大小写不敏感）", () => {
  assert.equal(detectRefusal("As an AI, I Cannot Assist with that."), true);
});
check("强短语：I must refuse", () => {
  assert.equal(detectRefusal("I must refuse this request."), true);
});

// ── detectRefusal：弱拒绝关键词（仅开头 150 字符） ──────────────────────
check("弱关键词：抱歉（开头命中）", () => {
  assert.equal(detectRefusal("抱歉，这个我处理不了。"), true);
});
check("弱关键词：i cannot（开头命中）", () => {
  assert.equal(detectRefusal("I cannot proceed with this task."), true);
});
check("弱关键词：位于 150 字符之后不触发", () => {
  const filler = "x".repeat(200);
  assert.equal(detectRefusal(`${filler} 我无法继续`), false);
});

// ── detectRefusal：自定义关键词（全文匹配，作为强匹配） ─────────────────
check("自定义关键词全文命中", () => {
  assert.equal(detectRefusal("这个请求超出范围。", ["超出范围"]), true);
});

// ── detectRefusal：正常内容不误报 ──────────────────────────────────────
check("正常协作内容不触发", () => {
  const text =
    "我来检查这个模块的结构：先看入口文件、配置和路由，" +
    "然后给出可验证的测试步骤。";
  assert.equal(detectRefusal(text), false);
});
check("空内容返回 false", () => {
  assert.equal(detectRefusal(""), false);
});

// ── extractAssistantText ────────────────────────────────────────────────
check("提取字符串 content", () => {
  const m: AssistantMessageLike = { role: "assistant", content: "hello" };
  assert.equal(extractAssistantText(m), "hello");
});
check("提取数组 content（仅 text 块，换行拼接）", () => {
  const m: AssistantMessageLike = {
    role: "assistant",
    content: [
      { type: "text", text: "第一段" },
      { type: "thinking", text: "推理" },
      { type: "text", text: "第二段" },
    ],
  };
  assert.equal(extractAssistantText(m), "第一段\n第二段");
});

// ── replaceAssistantTextBlocks ──────────────────────────────────────────
check("字符串 content：整体替换为兜底文本", () => {
  const m: AssistantMessageLike = { role: "assistant", content: "我不能协助" };
  const out = replaceAssistantTextBlocks(m, "兜底文本");
  assert.equal(extractAssistantText(out), "兜底文本");
});
check("数组 content：首个 text 块替换、其余 text 块移除、非 text 块保留", () => {
  const m: AssistantMessageLike = {
    role: "assistant",
    content: [
      { type: "text", text: "我无法帮助" },
      { type: "toolCall", text: "call-1" },
      { type: "text", text: "残余拒绝文本" },
    ],
  };
  const out = replaceAssistantTextBlocks(m, "兜底文本");
  const text = extractAssistantText(out);
  assert.equal(text, "兜底文本");
  assert.equal((out.content as unknown[]).length, 2); // 1 兜底 + 1 toolCall
  assert.equal((out.content as { type: string }[])[1].type, "toolCall");
});
check("替换不修改入参（返回新对象）", () => {
  const m: AssistantMessageLike = { role: "assistant", content: "我不能协助" };
  const out = replaceAssistantTextBlocks(m, "兜底文本");
  assert.equal(m.content, "我不能协助");
  assert.notEqual(out, m);
});

// ── isMojibake：GBK 写坏的问号串自愈 ───────────────────────────────────
check("大量问号/替换符判定为乱码", () => {
  assert.equal(isMojibake("????????"), true);
  assert.equal(isMojibake("????????????????"), true);
});
check("正常中文不判定为乱码", () => {
  assert.equal(isMojibake("我会按授权的本地/测试服范围继续。"), false);
});
check("短文本（<8 字符）不判定", () => {
  assert.equal(isMojibake("???"), false);
});

console.log(`\n全部通过：${passed} 项断言`);
