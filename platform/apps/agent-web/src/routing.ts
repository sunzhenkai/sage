import { useMemo, useSyncExternalStore } from 'react';

export const NAVIGATE_EVENT = 'sage:navigate';

let cachedSearch: string | undefined;
let cachedParams: URLSearchParams | undefined;

function snapshot(): URLSearchParams {
  const search = typeof window === 'undefined' ? '' : window.location.search;
  if (cachedSearch !== search) {
    cachedSearch = search;
    cachedParams = new URLSearchParams(search);
  }
  return cachedParams!;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('popstate', callback);
  window.addEventListener(NAVIGATE_EVENT, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(NAVIGATE_EVENT, callback);
  };
}

/** 响应式视图状态：传 searchOverride 时静态解析（测试用），否则订阅 popstate/自定义导航事件。 */
export function useLocation(searchOverride?: string): URLSearchParams {
  if (searchOverride !== undefined) {
    return useMemo(() => new URLSearchParams(searchOverride), [searchOverride]);
  }
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** 客户端路由：同源同 path 的链接用 pushState 切换，否则整页跳转（外部/下载/API）。 */
export function navigate(href: string): void {
  if (typeof window === 'undefined') return;
  const url = new URL(href, window.location.origin);
  if (url.origin === window.location.origin && url.pathname === window.location.pathname) {
    window.history.pushState(null, '', url.pathname + url.search + url.hash);
    window.dispatchEvent(new Event(NAVIGATE_EVENT));
  } else {
    window.location.assign(href);
  }
}

/** 站内查询路由链接：`?view=...`、`/?view=...` 或工作区根 `/`（含查询）。 */
export function isInternalRouteHref(href: string): boolean {
  if (href === '' || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('data:')) return false;
  if (href.startsWith('?')) return true;
  return href.split('?')[0] === '/' || href.split('?')[0] === '';
}

export interface AnchorLike {
  readonly getAttribute: (name: string) => string | null;
  readonly target?: string;
}

/** 对站内路由链接执行客户端导航并返回是否拦截；外部/下载/target=_blank 放行返回 false。 */
export function handleAnchorNavigation(anchor: AnchorLike, navigateFn: (href: string) => void): boolean {
  const href = anchor.getAttribute('href');
  if (href === null || !isInternalRouteHref(href)) return false;
  if (anchor.target === '_blank' || anchor.getAttribute('download') !== null) return false;
  navigateFn(href);
  return true;
}
