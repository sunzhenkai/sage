BEGIN;
-- 包运行运行契约：准入时固化的任务运行声明（输出 schema 文本、产物名清单、模型路由），供 worker 物化点校验与执行边界解析。
ALTER TABLE task_package_input ADD COLUMN IF NOT EXISTS run_contract jsonb;
COMMIT;
