import {act,create} from 'react-test-renderer';
import {describe,expect,it,vi} from 'vitest';
import {TasksApp,type TaskViewModel} from './tasks.js';

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const task:TaskViewModel={taskId:'task-ui',taskType:'sage.agent-task.v1',workflowId:'workflow-ui',targetId:'target-ui',attempt:1,status:'running',revision:1,projectionUpdatedAt:'2026-08-12T00:00:00.000Z',freshness:'stale',staleReason:'age_threshold_exceeded',targetSnapshot:{targetId:'target-ui',environment:'development',namespace:'sage-dev',taskQueue:'queue-ui'}};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const flush=()=>new Promise((resolve)=>setTimeout(resolve,0));
describe('P6 mounted Task UI interactions',()=>{
  it('uses cookie/session auth, renders stale detail/timeline/artifact, and refreshes after 202 controls without raw target',async()=>{
    const calls:{url:string;init?:RequestInit}[]=[];const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);calls.push({url,...(init?{init}:{})});if(url.endsWith('/v1/tasks'))return response({tasks:[task]});if(url.endsWith('/events'))return response({events:[{eventId:'event-ui',sequence:1,kind:'agent',type:'agent.task.running',occurredAt:'2026-08-12T00:00:01.000Z',payload:{}}]});if(url.endsWith('/artifacts'))return response({artifacts:[{artifactId:'output',artifactRef:'artifact://tasks/task-ui/output',name:'output.txt',mediaType:'text/plain'}]});if(init?.method==='POST')return response(task,202);return response(task);}) as typeof fetch;
    let tree!:ReturnType<typeof create>;await act(async()=>{tree=create(<TasksApp fetcher={fetcher} taskId="task-ui" sessionId="session-ui"/>);await flush();await flush();});expect(tree.root.findByProps({children:'task-ui'})).toBeTruthy();expect(calls.filter((call)=>call.url.endsWith('/v1/tasks/task-ui'))).toHaveLength(1);expect(tree.root.findByProps({'data-testid':'projection-freshness'}).findByType('strong').children).toContain('stale');expect(tree.root.findByProps({'aria-label':'Task timeline'})).toBeTruthy();expect(tree.root.findByProps({'aria-label':'Task artifacts'})).toBeTruthy();
    // 详情态刷新唯一：列表页头刷新隐藏，仅剩详情页头一处
    const refreshButtons=tree.root.findAllByType('button').filter((node)=>{const content=node.props.children;return (Array.isArray(content)?content.join(''):String(content)).includes('↻');});expect(refreshButtons).toHaveLength(1);
    await act(async()=>{tree.root.findByProps({children:'Cancel'}).props.onClick();await flush();});const control=calls.find((call)=>call.url.endsWith('/cancel'));expect(control?.init).toMatchObject({method:'POST',credentials:'include'});expect(control?.init?.headers).not.toHaveProperty('x-authentication-id');expect(control?.init?.body).toBe('{}');expect(JSON.stringify(calls)).not.toMatch(/targetId|endpoint|namespace/);expect(calls.filter((call)=>call.url.endsWith('/v1/tasks/task-ui')).length).toBe(2);await act(async()=>tree.unmount());
  });
  it('renders authenticated API errors instead of treating a 401 body as Task data',async()=>{const fetchMock=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>{void _input;void _init;return response({error:{code:'TASK_AUTHENTICATION_REQUIRED',message:'Sign in required'}},401);});const fetcher=fetchMock as unknown as typeof fetch;let tree!:ReturnType<typeof create>;await act(async()=>{tree=create(<TasksApp fetcher={fetcher}/>);await flush();});expect(tree.root.findByProps({role:'alert'}).findByType('p').children.join('')).toContain('Sign in required');expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({credentials:'include'});await act(async()=>tree.unmount());});
});

describe('P8 mounted run logs interactions',()=>{
  const runLogEvent=(eventId:string,sequence:number,type='run.started')=>({eventId,sequence,type,payload:{step:sequence}});
  it('fetches run logs with the detail group, switches attempts, and loads more pages without duplicates',async()=>{
    const calls:string[]=[];let page2=false;
    const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);calls.push(url);void init;
      if(url.endsWith('/v1/tasks'))return response({tasks:[task]});
      if(url.endsWith('/events'))return response({events:[]});
      if(url.endsWith('/artifacts'))return response({artifacts:[]});
      if(url.includes('/run-logs')){
        if(url.includes('fromSequence=3')){page2=true;return response({attempts:[{runId:'run-ui',attemptId:'attempt-0',eventCount:4,firstSequence:1,lastSequence:4,lastWrittenAt:'2026-08-12T00:04:00.000Z'}],selected:{runId:'run-ui',attemptId:'attempt-0'},events:[runLogEvent('event-3',3,'tool.completed'),runLogEvent('event-4',4,'run.completed')]});}
        if(url.includes('attemptId=attempt-0'))return response({attempts:[{runId:'run-ui',attemptId:'attempt-0',eventCount:4,firstSequence:1,lastSequence:4,lastWrittenAt:'2026-08-12T00:04:00.000Z'},{runId:'run-ui',attemptId:'attempt-1',eventCount:2,firstSequence:1,lastSequence:2,lastWrittenAt:'2026-08-12T00:02:00.000Z'}],selected:{runId:'run-ui',attemptId:'attempt-0'},events:[runLogEvent('event-0a',1),runLogEvent('event-0b',2)],nextFromSequence:3});
        return response({attempts:[{runId:'run-ui',attemptId:'attempt-0',eventCount:2,firstSequence:1,lastSequence:2,lastWrittenAt:'2026-08-12T00:00:00.000Z'},{runId:'run-ui',attemptId:'attempt-1',eventCount:2,firstSequence:1,lastSequence:2,lastWrittenAt:'2026-08-12T00:02:00.000Z'}],selected:{runId:'run-ui',attemptId:'attempt-1'},events:[runLogEvent('event-1',1),runLogEvent('event-2',2)]});
      }
      return response(task);}) as typeof fetch;
    let tree!:ReturnType<typeof create>;await act(async()=>{tree=create(<TasksApp fetcher={fetcher} taskId="task-ui"/>);await flush();await flush();});
    expect(calls.filter((url)=>url.endsWith('/run-logs'))).toHaveLength(1);
    const rowSequences=(node:ReturnType<typeof create>['root'])=>node.findAllByProps({'data-testid':'run-log-row'}).map((row)=>row.findByProps({className:'run-log-sequence'}).children.join(''));
    const select=tree.root.findByProps({'aria-label':'Select attempt'});
    expect(select.props.value).toBe('run-ui|attempt-1');
    await act(async()=>{select.props.onChange({target:{value:'run-ui|attempt-0'}});await flush();await flush();});
    expect(calls.some((url)=>url.includes('run-logs?runId=run-ui&attemptId=attempt-0'))).toBe(true);
    expect(rowSequences(tree.root)).toEqual(['#1','#2']);
    expect(page2).toBe(false);
    await act(async()=>{tree.root.findByProps({children:'Load more events'}).props.onClick();await flush();await flush();});
    expect(calls.some((url)=>url.includes('run-logs?runId=run-ui&attemptId=attempt-0&fromSequence=3'))).toBe(true);
    expect(rowSequences(tree.root)).toEqual(['#1','#2','#3','#4']);
    expect(tree.root.findAllByProps({children:'Load more events'})).toHaveLength(0);
    await act(async()=>tree.unmount());
  });
  it('keeps run logs unavailable state when the run-logs request fails inside a healthy detail group',async()=>{
    const fetcher=vi.fn(async(input:RequestInfo|URL,_init?:RequestInit)=>{void _init;const url=String(input);
      if(url.endsWith('/v1/tasks'))return response({tasks:[task]});
      if(url.endsWith('/events'))return response({events:[]});
      if(url.endsWith('/artifacts'))return response({artifacts:[]});
      if(url.endsWith('/run-logs'))return response({error:{code:'RUN_LOG_STORE_UNAVAILABLE',message:'unavailable'}},503);
      return response(task);}) as typeof fetch;
    let tree!:ReturnType<typeof create>;await act(async()=>{tree=create(<TasksApp fetcher={fetcher} taskId="task-ui"/>);await flush();await flush();});
    expect(tree.root.findByProps({'data-testid':'run-logs-unavailable'}).children.join('')).toContain('Run logs are unavailable right now.');
    expect(tree.root.findByProps({'aria-label':'Task timeline'})).toBeTruthy();
    await act(async()=>tree.unmount());
  });
});
