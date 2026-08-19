import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {TimelineEvent} from '@sage/app-contracts';
import {ChatTimeline} from './chat.js';
import {TaskDetail,TaskList,type TaskViewModel} from './tasks.js';
const task:TaskViewModel={taskId:'task-p6',taskType:'sage.agent-task.v1',workflowId:'workflow-p6',targetId:'target-original',attempt:2,status:'running',revision:3,projectionUpdatedAt:'2026-08-12T00:00:00.000Z',freshness:'stale',staleReason:'age_threshold_exceeded',targetSnapshot:{targetId:'target-original',environment:'production',namespace:'prod-ns',taskQueue:'queue-original'}};
describe('P6 Task and Task Card UI',()=>{
  it('renders list/detail stale timestamp, persisted target, Timeline, Artifact refs and authorized control affordances',()=>{
    const list=renderToStaticMarkup(<TaskList tasks={[task]}/>);expect(list).toContain('task-p6');expect(list).toContain('stale');expect(list).toContain('2026-08-12T00:00:00.000Z');
    const control=vi.fn();const detail=renderToStaticMarkup(<TaskDetail task={task} events={[{eventId:'event-1',sequence:1,kind:'agent',type:'agent.task.running',occurredAt:'2026-08-12T00:00:01.000Z',payload:{}}]} artifacts={[{artifactId:'output',artifactRef:'artifact://tasks/task-p6/output',name:'output.txt',mediaType:'text/plain'}]} onControl={control}/>);
    for(const value of ['workflow-p6','target-original','prod-ns','queue-original','agent.task.running','artifact://tasks/task-p6/output','Pause','Resume','Cancel','Retry'])expect(detail).toContain(value);
  });
  it('renders a real immutable Task Card link and suppresses the placeholder after promotion',()=>{
    const event:TimelineEvent={schemaVersion:'1',sessionId:'session-1',runId:'run-1',sequence:1,occurredAt:'2026-08-12T00:00:00.000Z',payload:{kind:'task',taskId:'task-p6',messageId:'message-1',title:'Task task-p6',status:'routed',promotionMode:'explicit',reason:'authenticated user explicitly promoted persisted Chat Message'}};
    const html=renderToStaticMarkup(<ChatTimeline events={[event]}/>);expect(html).toContain('task-p6');expect(html).toContain('view=tasks');expect(html).toContain('authenticated user explicitly promoted');expect(html).not.toContain('Promotion is explicit and becomes available in a later phase');
  });
});
