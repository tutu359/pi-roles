/**
 * pi-roles 单元测试 — 角色提示词注入（replace / append）
 *
 * 运行：npm test
 */
import assert from "node:assert/strict";
import { applyRolePrompt } from "../src/inject.ts";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const ROLE = "你是一名技术面试官，只提问不写代码。";

// ── replace：只换内置剧本，事实层交给 pi ──────────────────────────

check("replace：改写 customPrompt 并返回 undefined（不强制整体替换）", () => {
  const opts = { customPrompt: undefined as string | undefined };
  const patch = applyRolePrompt(
    { systemPrompt: "原内置剧本", systemPromptOptions: opts },
    "replace",
    ROLE,
  );
  assert.equal(patch, undefined);
  assert.equal(opts.customPrompt, ROLE);
});

check("replace：不覆盖 event.systemPrompt（事实层保留给 pi 拼装）", () => {
  const opts = { customPrompt: undefined as string | undefined };
  const ctx = { systemPrompt: "原内置剧本", systemPromptOptions: opts };
  applyRolePrompt(ctx, "replace", ROLE);
  assert.equal(ctx.systemPrompt, "原内置剧本");
});

check("replace：旧版 pi 无 options 时退化为整体替换", () => {
  const patch = applyRolePrompt({ systemPrompt: "原内置剧本" }, "replace", ROLE);
  assert.deepEqual(patch, { systemPrompt: ROLE });
});

check("replace：多次调用只改 customPrompt，不累积", () => {
  const opts = { customPrompt: undefined as string | undefined };
  applyRolePrompt({ systemPrompt: "内置", systemPromptOptions: opts }, "replace", ROLE);
  applyRolePrompt({ systemPrompt: "内置", systemPromptOptions: opts }, "replace", "另一个角色");
  assert.equal(opts.customPrompt, "另一个角色");
});

// ── append：保留内置剧本，模板追加在后 ────────────────────────────

check("append：在现有提示词后追加，内置剧本保留", () => {
  const patch = applyRolePrompt({ systemPrompt: "内置剧本正文" }, "append", ROLE);
  assert.equal(patch?.systemPrompt, `内置剧本正文\n\n${ROLE}`);
});

check("append：不改 customPrompt", () => {
  const opts = { customPrompt: undefined as string | undefined };
  applyRolePrompt({ systemPrompt: "内置", systemPromptOptions: opts }, "append", ROLE);
  assert.equal(opts.customPrompt, undefined);
});

console.log(`全部通过：${passed} 项断言`);
