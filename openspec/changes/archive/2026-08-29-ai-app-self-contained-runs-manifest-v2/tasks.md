# ai-app-self-contained-runs-manifest-v2 — Tasks

## 1. Schema 与校验

- [x] 1.1 `source-manifest.ts`：inputs/dataSources/tasks 的 typebox schema（bounds、唯一性、URL/枚举/maxBytes 约束、params 绑定值域）
- [x] 1.2 `source-loader.ts`：tasks 引用的 entry/schema 资产存在性校验（复用既有未声明资产拒绝路径）
- [x] 1.3 单测：合法矩阵 + 非法矩阵（清单越界/重复 name/非法 URL/引用缺失/绑定未声明/default 类型不符）全绿

## 2. 归一化与编译

- [x] 2.1 `compiler.ts`：归一化纯函数（隐式单任务展开、缺省继承 entry/schema/params 绑定），导出供运行时复用的类型
- [x] 2.2 lock manifest 摘要透传归一化声明；`capabilityRefs` 语义不变
- [x] 2.3 v1 golden 测试：无声明源包编译产物 Release 序列化与 contentDigest 逐字节等价，lock 摘要新增键白名单断言
- [x] 2.4 三个 smoke 测试（sample-app/github-trending/lifecycle-probe）维持通过（v1 形态不破坏）

## 3. 验证

- [x] 3.1 `pnpm --filter @sage/agent-package-release test` 与根 `pnpm typecheck && pnpm lint` 通过
