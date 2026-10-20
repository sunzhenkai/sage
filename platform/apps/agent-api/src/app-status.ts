/** App 准入查询：registry.getApp 对缺失与软删统一返回 undefined，调用方无需区分。 */
export interface AppStatusLookup {
  getApp(tenantId: string, appId: string): { readonly app: { readonly status: 'active' | 'deleted' } } | undefined;
}
