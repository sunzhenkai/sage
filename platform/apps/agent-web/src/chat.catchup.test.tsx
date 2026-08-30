import {act,create} from 'react-test-renderer';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ChatApp} from './chat.js';
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const flush=()=>new Promise((resolve)=>setTimeout(resolve,0));
class FakeEventSource{addEventListener(){}close(){}}
const runEvent=(sequence:number)=>({schemaVersion:'1',sessionId:'session-cu',runId:'run-cu',sequence,occurredAt:'2026-08-30T00:00:00.000Z',payload:{kind:'run',status:'succeeded',attempt:1}});
const userEvent=(sequence:number,text:string)=>({schemaVersion:'1',sessionId:'session-cu',runId:'run-cu',sequence,occurredAt:'2026-08-30T00:00:00.000Z',payload:{kind:'text',text,messageId:`message-${sequence}`,promotionEligibility:'explicit'}});
const countText=(tree:ReturnType<typeof create>,text:string)=>tree.root.findAll((node)=>node.props&&node.props.children===text).length;
const submit=async(tree:ReturnType<typeof create>,text:string)=>{
  await act(async()=>{
    const composer=tree.root.findByProps({'aria-label':'Message'});
    await composer.props.onChange({target:{value:text}});
    await flush();
  });
  await act(async()=>{
    const composer=tree.root.findByProps({'aria-label':'Message'});
    composer.props.onKeyDown({key:'Enter',shiftKey:false,nativeEvent:{isComposing:false},preventDefault(){}});
    await flush();
    await flush();
  });
};

const conn={id:'conn-ws',name:'ZTest WS',source:'user',adapterKind:'anthropic',baseUrl:'https://ztest.example.com',modelId:'dummy-model',enabled:true,credentialPresent:true};
describe('Chat send-path catch-up',()=>{
  afterEach(()=>{vi.unstubAllGlobals();});

  it('merges persisted events after a 202 submit so the user message is visible without SSE',async()=>{
    vi.stubGlobal('EventSource',FakeEventSource);
    const fetcher=vi.fn(async(input:RequestInfo|URL)=> {
      const url=String(input);
      if(url.endsWith('/provider-connections'))return response({schemaVersion:'ProviderConnections.v1',connections:[conn]});
      if(url.endsWith('/run-agent/settings'))return response({unset:false,providerConnectionId:'conn-ws'});
      if(url.endsWith('/v1/chat/sessions/session-cu'))return response({session:{status:'open'}});
      if(url.endsWith('/events?afterSequence=0'))return response({events:[runEvent(1)]});
      if(url.endsWith('/events?afterSequence=1'))return response({events:[userEvent(2,'前端冒烟测试 ping')]});
      return response({run:{}},202);
    }) as typeof fetch;
    let tree!:ReturnType<typeof create>;
    await act(async()=>{tree=create(<ChatApp sessionId="session-cu" fetcher={fetcher}/>);await flush();});
    expect(countText(tree,'前端冒烟测试 ping')).toBe(0);
    await submit(tree,'前端冒烟测试 ping');
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/events?afterSequence=1'),expect.anything());
    expect(countText(tree,'前端冒烟测试 ping')).toBe(1);
    await act(async()=>tree.unmount());
  });

  it('deduplicates catch-up events against the loaded timeline',async()=>{
    vi.stubGlobal('EventSource',FakeEventSource);
    const fetcher=vi.fn(async(input:RequestInfo|URL)=> {
      const url=String(input);
      if(url.endsWith('/provider-connections'))return response({schemaVersion:'ProviderConnections.v1',connections:[conn]});
      if(url.endsWith('/run-agent/settings'))return response({unset:false,providerConnectionId:'conn-ws'});
      if(url.endsWith('/v1/chat/sessions/session-cu'))return response({session:{status:'open'}});
      if(url.endsWith('/events?afterSequence=0'))return response({events:[runEvent(1)]});
      if(url.endsWith('/events?afterSequence=1'))return response({events:[userEvent(2,'echo'),userEvent(3,'tail')]});
      return response({run:{}},202);
    }) as typeof fetch;
    let tree!:ReturnType<typeof create>;
    await act(async()=>{tree=create(<ChatApp sessionId="session-cu" fetcher={fetcher}/>);await flush();});
    await submit(tree,'trigger');
    expect(countText(tree,'echo')).toBe(1);
    // 合并后 timeline 事件总数为 3（1 run + 2 catch-up），无重复。
    expect(tree.root.findAll((node)=>node.props&&node.props['data-sequence']!==undefined).length).toBe(2);
    await act(async()=>tree.unmount());
  });

  it('keeps the loaded timeline and composer usable when catch-up fails',async()=>{
    vi.stubGlobal('EventSource',FakeEventSource);
    const fetcher=vi.fn(async(input:RequestInfo|URL)=> {
      const url=String(input);
      if(url.endsWith('/provider-connections'))return response({schemaVersion:'ProviderConnections.v1',connections:[conn]});
      if(url.endsWith('/run-agent/settings'))return response({unset:false,providerConnectionId:'conn-ws'});
      if(url.endsWith('/v1/chat/sessions/session-cu'))return response({session:{status:'open'}});
      if(url.endsWith('/events?afterSequence=0'))return response({events:[runEvent(1)]});
      if(url.endsWith('/events?afterSequence=1'))return new Response('boom',{status:500});
      return response({run:{}},202);
    }) as typeof fetch;
    let tree!:ReturnType<typeof create>;
    await act(async()=>{tree=create(<ChatApp sessionId="session-cu" fetcher={fetcher}/>);await flush();});
    await submit(tree,'second message');
    expect(tree.root.findAll((node)=>node.props&&typeof node.props.className==='string'&&node.props.className.includes('banner-error')).length).toBe(0);
    expect(tree.root.findByProps({'aria-label':'Message'}).props.disabled).toBe(false);
    await act(async()=>tree.unmount());
  });
});
