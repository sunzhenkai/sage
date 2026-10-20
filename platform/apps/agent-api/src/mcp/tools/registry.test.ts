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

  it('app 草稿/发布工具替代 package 工具', () => {
    const names = allTools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'app_update', 'app_get_draft', 'app_put_draft', 'app_publish_release', 'app_list_releases'
    ]));
    expect(names.some((name) => name.startsWith('package_'))).toBe(false);
    expect(names).not.toContain('app_upload_release');
  });

  it('app 草稿与发布工具的请求形状正确', () => {
    const put = allTools.find((tool) => tool.name === 'app_put_draft');
    expect(put?.build({ appId: 'demo app', files: { 'app.yaml': 'id: demo' }, ifMatch: '"r2"' })).toEqual({
      method: 'PUT', path: '/v1/apps/demo%20app/draft', headers: { 'if-match': '"r2"' },
      body: { files: { 'app.yaml': 'id: demo' } }
    });
    const publish = allTools.find((tool) => tool.name === 'app_publish_release');
    expect(publish?.build({ appId: 'demo', baseRevision: 3 })).toEqual({
      method: 'POST', path: '/v1/apps/demo/releases', body: { baseRevision: 3 }
    });
    const list = allTools.find((tool) => tool.name === 'app_list_releases');
    expect(list?.build({ appId: 'demo' })).toEqual({ method: 'GET', path: '/v1/apps/demo/releases' });
  });
});
