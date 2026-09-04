import {act,create} from 'react-test-renderer';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ChatApp} from './chat.js';
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const flush=()=>new Promise((resolve)=>setTimeout(resolve,0));
class FakeEventSource{addEventListener(){}close(){}}
const conn={id:'conn-ws',name:'ZTest WS',source:'user',adapterKind:'anthropic',baseUrl:'https://ztest.example.com',modelId:'dummy-model',enabled:true,credentialPresent:true};

describe('promotion success notice links to the created task',()=>{
  afterEach(()=>{vi.unstubAllGlobals();});
  it('renders a View task action pointing at the promoted task',async()=>{
    vi.stubGlobal('EventSource',FakeEventSource);
    const fetcher=vi.fn(async(input:RequestInfo|URL)=> {
      const url=String(input);
      if(url.endsWith('/provider-connections'))return response({schemaVersion:'ProviderConnections.v1',connections:[conn]});
      if(url.endsWith('/run-agent/settings'))return response({unset:false,providerConnectionId:'conn-ws'});
      if(url.endsWith('/v1/chat/sessions/session-ui'))return response({session:{status:'open'}});
      if(url.includes('/events?'))return response({events:[{schemaVersion:'1',sessionId:'session-ui',runId:'run-ui',sequence:1,occurredAt:'2026-08-12T00:00:00.000Z',payload:{kind:'text',text:'durable request',messageId:'message-ui',promotionEligibility:'explicit'}},{schemaVersion:'1',sessionId:'session-ui',runId:'run-ui',sequence:2,occurredAt:'2026-08-12T00:00:01.000Z',payload:{kind:'run',status:'succeeded',attempt:1}}]});
      return response({association:{taskId:'task-ui'}},202);
    }) as typeof fetch;
    let tree!:ReturnType<typeof create>;
    await act(async()=>{tree=create(<ChatApp sessionId="session-ui" fetcher={fetcher}/>);await flush();});
    await act(async()=>{tree.root.findByProps({children:'Promote to Task'}).props.onClick();await flush();});
    const banner=tree.root.find((node)=>node.props.className==='success-banner');
    const link=banner.findAll((node)=>node.props.href!==undefined&&String(node.props.href).includes('view=tasks'));
    expect(link.length).toBe(1);
    expect(String(link[0]!.props.href)).toContain('task=task-ui');
    expect(link[0]!.props.children[0]).toBe('View task');
    await act(async()=>tree.unmount());
  });
});
