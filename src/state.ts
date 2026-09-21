/**
 * 角色系统状态机（纯函数，无副作用）
 *
 * 菜单 / 启动旗标 / 会话恢复共用同一套动作，保证行为一致且可单测。
 * 状态：role（当前角色，null = 注入关闭）+ mode（注入模式）+ intercept（拦截总闸）。
 */

/** 注入模式：append 在现有系统提示词后追加（默认，保留原生剧本）；replace 替换系统提示词（强场景） */
export type InjectionMode = "append" | "replace";

export function isInjectionMode(value: unknown): value is InjectionMode {
  return value === "append" || value === "replace";
}

/** 角色系统状态（纯数据，可持久化、可恢复） */
export interface RoleState {
  /** 当前角色（null = 注入关闭） */
  role: string | null;
  /** 注入模式 */
  mode: InjectionMode;
  /** 自动拦截总闸（仅 role 非空时生效） */
  intercept: boolean;
}

/** 默认状态：无角色、追加模式（默认）、拦截开 */
export function defaultRoleState(): RoleState {
  return { role: null, mode: "append", intercept: true };
}

/** 状态机动作 */
export type RoleAction =
  | { type: "selectRole"; role: string }
  | { type: "clearRole" }
  | { type: "setMode"; mode: InjectionMode }
  | { type: "toggleIntercept" };

/** 纯函数状态机：应用动作返回新状态（不修改入参） */
export function applyRoleState(
  state: RoleState,
  action: RoleAction,
): RoleState {
  switch (action.type) {
    case "selectRole":
      return { ...state, role: action.role };
    case "clearRole":
      return { ...state, role: null };
    case "setMode":
      return { ...state, mode: action.mode };
    case "toggleIntercept":
      return { ...state, intercept: !state.intercept };
  }
}

/** 拦截是否实际生效：总闸开 && 有角色 */
export function interceptActive(state: RoleState): boolean {
  return state.intercept && state.role !== null;
}

/** 状态条短文本（如 R:ctf · append · 🛡）；无角色时返回 undefined（清空状态条） */
export function statusShort(state: RoleState): string | undefined {
  if (!state.role) return undefined;
  const parts = [`R:${state.role}`, state.mode];
  if (state.intercept) parts.push("🛡");
  return parts.join(" · ");
}
