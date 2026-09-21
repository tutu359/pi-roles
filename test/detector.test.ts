/**
 * pi-roles 单元测试 — 关键词解析 / 拒绝检测 / 文本提取 / 替换
 *
 * 运行：npm test
 */
import assert from "node:assert/strict";
import {
  HEAD_LIMIT,
  detectRefusal,
  extractAssistantText,
  loadKeywords,
  parseKeywords,
  replaceAssistantTextBlocks,
  type AssistantMessageLike,
  type RefusalKeywords,
} from "../src/detector.ts";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** 测试用固定词表（与 keywords.txt 无关，保证断言确定性） */
const KW: RefusalKeywords = {
  strong: ["我无法协助", "i cannot assist", "i must refuse"],
  weak: ["抱歉", "i cannot"],
};

console.log("pi-roles detector 测试\n");

// ── parseKeywords：段落解析 ─────────────────────────────────────
check("parseKeywords：分段落、忽略注释与空行", () => {
  const parsed = parseKeywords(
    [
      "# 注释",
      "",
      "我无法协助",
      "[全文]",
      "i must refuse",
      "[开头]",
      "抱歉",
      "# 又一个注释",
      "sorry",
    ].join("\n"),
  );
  assert.deepEqual(parsed.strong, ["我无法协助", "i must refuse"]);
  assert.deepEqual(parsed.weak, ["抱歉", "sorry"]);
});
check("parseKeywords：段落标记前的词默认归入全文段", () => {
  const parsed = parseKeywords("aaa\n[开头]\nbbb");
  assert.deepEqual(parsed.strong, ["aaa"]);
  assert.deepEqual(parsed.weak, ["bbb"]);
});

// ── loadKeywords：随仓库分发的 keywords.txt 可正常加载 ───────────
check("loadKeywords：加载 keywords.txt 且两个段都非空", () => {
  const kw = loadKeywords();
  assert.ok(kw.strong.length > 0, "全文段不应为空");
  assert.ok(kw.weak.length > 0, "开头段不应为空");
  assert.ok(kw.strong.includes("我无法协助"));
  assert.ok(kw.weak.includes("抱歉"));
});

// ── detectRefusal：全文段（任意位置命中） ────────────────────────
check("全文段：任意位置命中", () => {
  assert.equal(detectRefusal("不好意思，我无法协助完成该请求。", KW), true);
  assert.equal(detectRefusal("As an AI, I Cannot Assist with that.", KW), true);
  assert.equal(detectRefusal("I must refuse this request.", KW), true);
});
check("全文段：大小写不敏感", () => {
  assert.equal(detectRefusal("I MUST REFUSE THIS.", KW), true);
});

// ── detectRefusal：开头段（仅前 HEAD_LIMIT 字符） ─────────────
check("开头段：开头命中", () => {
  assert.equal(detectRefusal("抱歉，这个我处理不了。", KW), true);
  assert.equal(detectRefusal("I cannot proceed with this task.", KW), true);
});
check(`开头段：位于 ${HEAD_LIMIT} 字符之后不触发`, () => {
  const filler = "x".repeat(HEAD_LIMIT + 50);
  assert.equal(detectRefusal(`${filler} 我无法继续`, KW), false);
});

// ── detectRefusal：词表就是唯一来源 ────────────────────────────
check("不在词表里的说法不触发", () => {
  assert.equal(detectRefusal("这个请求超出范围。", KW), false);
});
check("加进词表后立即生效", () => {
  const extended: RefusalKeywords = { ...KW, strong: [...KW.strong, "超出范围"] };
  assert.equal(detectRefusal("这个请求超出范围。", extended), true);
});

// ── detectRefusal：正常内容不误报 ──────────────────────────────
check("正常协作内容不触发", () => {
  const text =
    "我来检查这个模块的结构：先看入口文件、配置和路由，" +
    "然后给出可验证的测试步骤。";
  assert.equal(detectRefusal(text, KW), false);
});
check("空内容返回 false", () => {
  assert.equal(detectRefusal("", KW), false);
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


console.log(`\n全部通过：${passed} 项断言`);
