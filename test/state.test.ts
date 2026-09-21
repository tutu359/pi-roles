/**
 * pi-roles 状态机单元测试（纯函数，node --experimental-strip-types 直接运行）
 *
 * 运行：npm test
 */
import assert from "node:assert/strict";
import {
  applyRoleState,
  defaultRoleState,
  interceptActive,
  isInjectionMode,
  type RoleState,
} from "../src/state.ts";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("pi-roles state 状态机测试\n");

// ── 默认状态 ─────────────────────────────────────────────────────────────
check("默认：无角色 · 追加模式 · 自动拦截关闭", () => {
  const s = defaultRoleState();
  assert.deepEqual(s, { role: null, mode: "append", intercept: false });
});

// ── selectRole / clearRole ───────────────────────────────────────────────
check("selectRole 设置角色，并自动开启自动拦截", () => {
  const s = applyRoleState(defaultRoleState(), {
    type: "selectRole",
    role: "ctf",
  });
  assert.deepEqual(s, { role: "ctf", mode: "append", intercept: true });
});
check("clearRole 清空角色，自动拦截回到关闭", () => {
  const s = applyRoleState(
    { role: "ctf", mode: "replace", intercept: true },
    { type: "clearRole" },
  );
  assert.deepEqual(s, { role: null, mode: "replace", intercept: false });
});

// ── setMode / toggleIntercept ────────────────────────────────────────────
check("setMode 切换模式", () => {
  const s = applyRoleState(defaultRoleState(), {
    type: "setMode",
    mode: "replace",
  });
  assert.equal(s.mode, "replace");
});
check("toggleIntercept 手动翻转（默认关 → 开 → 关）", () => {
  const s1 = applyRoleState(defaultRoleState(), { type: "toggleIntercept" });
  assert.equal(s1.intercept, true);
  const s2 = applyRoleState(s1, { type: "toggleIntercept" });
  assert.equal(s2.intercept, false);
});

// ── 不修改入参（纯函数） ─────────────────────────────────────────────────
check("applyRoleState 不修改入参", () => {
  const before: RoleState = { role: null, mode: "append", intercept: true };
  const after = applyRoleState(before, { type: "setMode", mode: "replace" });
  assert.equal(before.mode, "append");
  assert.equal(after.mode, "replace");
});

// ── interceptActive：总闸 && 有角色 ──────────────────────────────────────
check("拦截生效：有角色 + 总闸开", () => {
  assert.equal(interceptActive({ role: "ctf", mode: "append", intercept: true }), true);
});
check("拦截不生效：无角色（即使总闸开）", () => {
  assert.equal(interceptActive({ role: null, mode: "append", intercept: true }), false);
});
check("拦截不生效：总闸关（即使有角色）", () => {
  assert.equal(interceptActive({ role: "ctf", mode: "append", intercept: false }), false);
});

// ── isInjectionMode ──────────────────────────────────────────────────────
check("isInjectionMode 校验", () => {
  assert.equal(isInjectionMode("append"), true);
  assert.equal(isInjectionMode("replace"), true);
  assert.equal(isInjectionMode("ctf"), false);
  assert.equal(isInjectionMode(undefined), false);
});

console.log(`\n全部通过：${passed} 项断言`);
