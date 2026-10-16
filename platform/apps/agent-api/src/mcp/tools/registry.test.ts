import { describe, expect, it } from 'vitest';
import { allTools, EXCLUDED_PATHS, REQUIRED_GROUPS } from './registry.js';

describe('MCP tool registry 覆盖断言', () => {
  it('每个判据资源组至少一个 tool', () => {
    for (const group of REQUIRED_GROUPS) {
      const hit = allTools.some((t) => t.name === group || t.name.startsWith(`${group}_`));
      expect(hit, `资源组 ${group} 缺少 tool`).toBe(true);
    }
  });

  it('tool 命名符合 {group}_{action} snake_case', () => {
    for (const tool of allTools) {
      expect(tool.name, tool.name).toMatch(/^[a-z][a-z0-9]*(_[a-z][a-z0-9]*)+$/);
    }
  });

  it('排除清单路径不映射为 tool', () => {
    for (const tool of allTools) {
      const path = tool.build({});
      for (const excluded of EXCLUDED_PATHS) {
        // 排除项带 :param，比较前缀段（如 /livez、/readyz、/internal、/mcp）。
        const excludedSegments = excluded.split('/').filter(Boolean);
        const pathSegments = path.path.split('/').filter(Boolean);
        const isPrefixMatch = excludedSegments.every((seg, i) => pathSegments[i] === seg || seg.startsWith(':'));
        expect(isPrefixMatch && excludedSegments.length <= pathSegments.length, `tool ${tool.name} 映射了排除路径 ${excluded}`).toBe(false);
      }
    }
  });

  it('timeline SSE 不映射（用 events 游标替代）', () => {
    const hit = allTools.some((t) => t.build({ sessionId: 'x' }).path.endsWith('/timeline'));
    expect(hit).toBe(false);
  });

  it('每个 tool 有非空 name / description / schema', () => {
    for (const tool of allTools) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.schema).toBe('object');
    }
  });

  it('tool 名不重复', () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
