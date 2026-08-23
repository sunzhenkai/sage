## 1. 准备

- [x] 1.1 把涉及面里角色为必须的仓切到任务分支（当前 main 工作树干净，需新建/切到 `feat/flash-fix`）

## 2. 实施

- [x] 2.1 完成子 change `flash-fix-routing`：客户端路由（History API 封装 + 全局 `<a>` 拦截 + 布局/内容分离 + 测试适配），apply 至全部 checkbox 勾选且 `openspec validate --strict --type change flash-fix-routing` 通过
- [x] 2.2 完成子 change `flash-fix-firstpaint`：背景内联 `index.html` + `#root` 首帧骨架屏，apply 至全部 checkbox 勾选且 `openspec validate --strict --type change flash-fix-firstpaint` 通过
- [x] 2.3 完成子 change `flash-fix-cache`：`vite.config.ts` preview 静态资源强缓存（`/assets/*` immutable，index.html no-cache），apply 至全部 checkbox 勾选且 `openspec validate --strict --type change flash-fix-cache` 通过

## 3. 收尾

- [x] 3.1 全仓回归与静态检查（typecheck / build / lint / 相关单测），命令与结果写入 proposal 验证记录
- [x] 3.2 回填 proposal 验收标准（勾选各项）
- [ ] 3.3 提交交付仓改动
- [ ] 3.4 归档全部子 change（`openspec archive` 逐个执行）
