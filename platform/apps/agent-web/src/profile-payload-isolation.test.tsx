import { readFile } from 'node:fs/promises';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatApp } from './chat.js';
import { TasksApp, type TaskViewModel } from './tasks.js';
import { PROVIDER_SECRET_PREFIX, PROVIDER_V2_STORAGE_KEY } from './profiles.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class MemoryStorage implements Storage { #data = new Map<string,string>(); get length(){return this.#data.size;} clear(){this.#data.clear();} getItem(k:string){return this.#data.get(k)??null;} key(i:number){return [...this.#data.keys()][i]??null;} removeItem(k:string){this.#data.delete(k);} setItem(k:string,v:string){this.#data.set(k,v);} }
class FakeEventSource { addEventListener(){} close(){} }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const forbidden = /provider|model|profile|baseurl|api.?key|secret|target|endpoint|namespace|actor|roles/i;
function configuredWindow() { const localStorage = new MemoryStorage(); const sessionStorage = new MemoryStorage(); localStorage.setItem(PROVIDER_V2_STORAGE_KEY, JSON.stringify([{ id:'external', name:'External', enabled:true, adapterKind:'openai-compatible', providerId:'p', providerName:'Provider', modelId:'m', modelName:'Model', baseUrl:'https://external.example/v1', baseUrlSource:'manual', updatedAt:'2026-08-14T00:00:00.000Z' }])); sessionStorage.setItem(`${PROVIDER_SECRET_PREFIX}external`, 'tab-secret'); vi.stubGlobal('window', { localStorage, sessionStorage }); }

describe('configured Provider profiles remain outside execution payloads', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('keeps Chat submit, retry, and promotion bodies profile-neutral', async () => {
    configuredWindow(); vi.stubGlobal('EventSource', FakeEventSource);
    const posts: { url: string; body?: BodyInit | null }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { const url = String(input);
      if (init?.method === 'POST') { posts.push({ url, ...(init.body === undefined ? {} : { body: init.body }) }); return response({}, 202); }
      if (url.endsWith('/v1/chat/sessions/session-profile')) return response({ session: { status: 'open' } });
      if (url.includes('/events?')) return response({ events: [
        { schemaVersion:'1', sessionId:'session-profile', runId:'run-retry', sequence:1, occurredAt:'2026-08-14T00:00:00.000Z', payload:{ kind:'error', error:{ code:'CHAT_FAILED', message:'failed', retryable:true } } },
        { schemaVersion:'1', sessionId:'session-profile', runId:'run-user', sequence:2, occurredAt:'2026-08-14T00:00:01.000Z', payload:{ kind:'text', text:'promote me', messageId:'message-profile', promotionEligibility:'explicit' } }
      ] });
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ChatApp sessionId="session-profile" fetcher={fetcher} />); await flush(); await flush(); });
    await act(async () => { tree.root.findByType('textarea').props.onChange({ target:{ value:'hello' } }); });
    await act(async () => { tree.root.findByType('form').props.onSubmit({ preventDefault(){} }); await flush(); });
    await act(async () => { tree.root.findByProps({ children:'Retry run' }).props.onClick(); await flush(); });
    await act(async () => { tree.root.findByProps({ children:'Promote to Task' }).props.onClick(); await flush(); });
    expect(posts.map((call) => call.url)).toEqual(expect.arrayContaining([
      expect.stringContaining('/messages'), expect.stringContaining('/runs/run-retry/retry'), expect.stringContaining('/messages/message-profile/promotions')
    ]));
    expect(JSON.parse(String(posts.find((call) => call.url.endsWith('/messages'))?.body))).toEqual({ parts:[{ kind:'text', text:'hello' }] });
    expect(posts.find((call) => call.url.endsWith('/retry'))?.body).toBeUndefined();
    expect(JSON.parse(String(posts.find((call) => call.url.endsWith('/promotions'))?.body))).toEqual({ mode:'explicit', taskType:'sage.agent-task.v1' });
    expect(JSON.stringify(posts.map((call) => call.body ?? null))).not.toMatch(forbidden);
    await act(async () => tree.unmount());
  });

  it('keeps Task signal, retry, and cancel bodies profile-neutral', async () => {
    configuredWindow(); let currentStatus = 'running'; const posts: { url:string; body?:BodyInit|null }[] = [];
    const task = (): TaskViewModel => ({ taskId:'task-profile', taskType:'sage.agent-task.v1', workflowId:'workflow', targetId:'immutable-target', attempt:1, status:currentStatus, revision:1, projectionUpdatedAt:'2026-08-14T00:00:00.000Z', freshness:'fresh', targetSnapshot:{ targetId:'immutable-target', environment:'development', namespace:'immutable', taskQueue:'immutable' } });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { const url=String(input);
      if (init?.method === 'POST') { posts.push({ url, ...(init.body === undefined ? {} : { body:init.body }) }); if (url.endsWith('/signals')) currentStatus='failed'; return response(task(),202); }
      if (url.endsWith('/v1/tasks')) return response({ tasks:[task()] }); if (url.endsWith('/events')) return response({ events:[] }); if (url.endsWith('/artifacts')) return response({ artifacts:[] }); return response(task());
    }) as typeof fetch;
    let tree!:ReturnType<typeof create>; await act(async()=>{tree=create(<TasksApp fetcher={fetcher} taskId="task-profile"/>);await flush();await flush();});
    await act(async()=>{tree.root.findByProps({children:'Pause'}).props.onClick();await flush();await flush();});
    await act(async()=>{tree.root.findByProps({children:'Retry'}).props.onClick();await flush();await flush();});
    await act(async()=>{tree.root.findByProps({children:'Cancel'}).props.onClick();await flush();await flush();});
    expect(JSON.parse(String(posts.find((call)=>call.url.endsWith('/signals'))?.body))).toEqual({kind:'pause'});
    expect(posts.find((call)=>call.url.endsWith('/retry'))?.body).toBe('{}'); expect(posts.find((call)=>call.url.endsWith('/cancel'))?.body).toBe('{}');
    expect(JSON.stringify(posts.map((call)=>call.body))).not.toMatch(forbidden);
    await act(async()=>tree.unmount());
  });

  it('keeps Task create allowlisting and both API/Worker default assembly on Local PiHarness', async () => {
    configuredWindow();
    const [taskApi, apiRuntime, workerRuntime, localRuntime, chatApi] = await Promise.all([
      readFile(new URL('../../agent-api/src/task-api.ts', import.meta.url), 'utf8'), readFile(new URL('../../agent-api/src/runtime.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../agent-worker/src/runtime.ts', import.meta.url), 'utf8'), readFile(new URL('../../../packages/local-runtime/src/index.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../agent-api/src/index.ts', import.meta.url), 'utf8')
    ]);
    expect(taskApi).toContain("new Set(['taskId', 'taskType', 'inputRef', 'maxSlices', 'sliceDelayMs', 'slice'])");
    expect(taskApi).not.toMatch(/ProviderProfile|provider-profiles|sessionStorage|localStorage/);
    for (const runtime of [apiRuntime, workerRuntime]) { expect(runtime).toContain('createLocalAgentClient()'); expect(runtime).not.toMatch(/ProviderProfile|provider-profiles|sessionStorage|localStorage/); }
    // The live provider composition is the only sanctioned addition: request-scoped, behind LocalAgentClient,
    // and never touches browser storage or persistence from the runtime packages.
    expect(localRuntime).toContain('createExplicitLegacyPiHarness()');
    expect(localRuntime).toContain('createLiveProviderAgentClient');
    expect(localRuntime).not.toMatch(/sessionStorage|localStorage/);
    expect(chatApi).not.toMatch(/sessionStorage|localStorage|ProviderProfile|provider-profiles/);
  });
});
