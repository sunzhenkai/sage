import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {TimelineEvent} from '@sage/app-contracts';
import {ChatTimeline} from './chat.js';
import {RunLogsPanel,TaskDetail,TaskList,type TaskRunLogsView,type TaskViewModel} from './tasks.js';
const task:TaskViewModel={taskId:'task-p6',taskType:'sage.agent-task.v1',workflowId:'workflow-p6',targetId:'target-original',attempt:2,status:'running',revision:3,projectionUpdatedAt:'2026-08-12T00:00:00.000Z',freshness:'stale',staleReason:'age_threshold_exceeded',targetSnapshot:{targetId:'target-original',environment:'production',namespace:'prod-ns',taskQueue:'queue-original'}};
const runLogs:TaskRunLogsView={attempts:[{runId:'run-p6',attemptId:'attempt-2',eventCount:1,firstSequence:1,lastSequence:1,lastWrittenAt:'2026-08-12T00:02:00.000Z'},{runId:'run-p6',attemptId:'attempt-1',eventCount:2,firstSequence:1,lastSequence:2,lastWrittenAt:'2026-08-12T00:01:00.000Z'}],selected:{runId:'run-p6',attemptId:'attempt-2'},events:[{eventId:'event-2',sequence:1,type:'run.started',payload:{goal:'publish report'}},{eventId:'event-3',sequence:2,type:'run.failed',payload:{},artifactRefs:['artifact://tasks/task-p6/output'],receiptRefs:['receipt://one','receipt://two']}],nextFromSequence:3};
describe('P8 Task run logs panel',()=>{
  it('renders run log rows with sequence gutter, typed badges, payload summary and reference counts',()=>{
    const html=renderToStaticMarkup(<RunLogsPanel runLogs={runLogs}/>);
    expect(html).toContain('Run logs');
    expect(html).toContain('data-testid="run-log-list"');
    for(const value of ['#1','#2','run.started','run.failed','run-log-type-neutral','run-log-type-danger','goal=publish report','3 refs'])expect(html).toContain(value);
    expect(html).toContain('Select attempt');
    expect(html).toContain('Load more events');
    expect(html).not.toMatch(/endpoint|namespace|apiKey|credentialRef/i);
  });
  it('shows localized empty state without attempts and unavailable state on error',()=>{
    expect(renderToStaticMarkup(<RunLogsPanel runLogs={{attempts:[],events:[]}}/>)).toContain('No run events have been recorded for this task yet.');
    expect(renderToStaticMarkup(<RunLogsPanel runLogs={runLogs} error/>)).toContain('Run logs are unavailable right now.');
  });
  it('keeps the attempt selector to multi-attempt tasks and hides load-more when exhausted',()=>{
    const single:TaskRunLogsView={attempts:[runLogs.attempts[0]!],...(runLogs.selected?{selected:runLogs.selected}:{}),events:runLogs.events};
    const html=renderToStaticMarkup(<RunLogsPanel runLogs={single}/>);
    expect(html).not.toContain('Select attempt');
    expect(html).not.toContain('Load more events');
  });
});
describe('P6 Task and Task Card UI',()=>{
  it('renders a jargon-free timeline empty state when the projection is fresh',()=>{
    const {staleReason:_drop,...freshBase}=task;void _drop;
    const html=renderToStaticMarkup(<TaskDetail task={{...freshBase,freshness:'fresh'}} events={[]} artifacts={[]} onControl={vi.fn()}/>);
    expect(html).toContain('No timeline events yet.');
    expect(html).not.toContain('projection events');
  });
  it('renders list/detail stale timestamp, persisted target, Timeline, Artifact refs and authorized control affordances',()=>{
    const list=renderToStaticMarkup(<TaskList tasks={[task]}/>);expect(list).toContain('task-p6');expect(list).toContain('stale');expect(list).toContain('2026-08-12T00:00:00.000Z');
    const control=vi.fn();const detail=renderToStaticMarkup(<TaskDetail task={task} events={[{eventId:'event-1',sequence:1,kind:'agent',type:'agent.task.running',occurredAt:'2026-08-12T00:00:01.000Z',payload:{}}]} artifacts={[{artifactId:'output',artifactRef:'artifact://tasks/task-p6/output',name:'output.txt',mediaType:'text/plain'}]} onControl={control}/>);
    for(const value of ['workflow-p6','target-original','prod-ns','queue-original','agent.task.running','artifact://tasks/task-p6/output','Pause','Resume','Cancel','Retry'])expect(detail).toContain(value);
  });
  it('shows output.tar.gz download, file list, and text-only preview on succeeded tasks',()=>{
    const detail=renderToStaticMarkup(<TaskDetail task={{...task,status:'succeeded'}} events={[]} artifacts={[
      {artifactId:'pkg',artifactRef:'artifact://tasks/task-p6/output',name:'output.tar.gz',mediaType:'application/gzip'},
      {artifactId:'brief',artifactRef:'artifact://tasks/task-p6/output#file/brief.md',name:'brief.md',mediaType:'text/markdown'},
      {artifactId:'bin',artifactRef:'artifact://tasks/task-p6/output#file/data.bin',name:'data.bin',mediaType:'application/octet-stream'}
    ]} onControl={vi.fn()}/>);
    expect(detail).toContain('Download tar.gz');
    expect(detail).toContain('aria-label="Output files"');
    expect(detail).toContain('brief.md');
    expect(detail).toContain('data.bin');
    expect(detail).toContain('download=1');
  });
  it('shows failure code and keeps retry enabled',()=>{
    const detail=renderToStaticMarkup(<TaskDetail task={{...task,status:'failed',failureCode:'PACKAGE_OUTPUT_MISSING_FILE',failureDetail:'missing brief.md'}} events={[]} artifacts={[]} onControl={vi.fn()}/>);
    expect(detail).toContain('PACKAGE_OUTPUT_MISSING_FILE');
    expect(detail).toContain('missing brief.md');
    expect(detail).toContain('aria-label="Failure"');
    expect(detail).toContain('Retry');
    expect(detail).not.toMatch(/<button[^>]*disabled[^>]*>Retry/);
  });
  it('explains effect_unknown in plain language, keeps controls locked, and translates the stale reason',()=>{
    const detail=renderToStaticMarkup(<TaskDetail task={{...task,status:'effect_unknown'}} events={[]} artifacts={[]} onControl={vi.fn()}/>);
    for(const value of ['Effect unknown — confirm the outcome before continuing','duplicate side effects','effect resolution process','start a new task','No projection update within the freshness threshold','disabled'])expect(detail).toContain(value);
  });
  it('renders a real immutable Task Card link and suppresses the placeholder after promotion',()=>{
    const event:TimelineEvent={schemaVersion:'1',sessionId:'session-1',runId:'run-1',sequence:1,occurredAt:'2026-08-12T00:00:00.000Z',payload:{kind:'task',taskId:'task-p6',messageId:'message-1',title:'Task task-p6',status:'routed',promotionMode:'explicit',reason:'authenticated user explicitly promoted persisted Chat Message'}};
    const html=renderToStaticMarkup(<ChatTimeline events={[event]}/>);expect(html).toContain('task-p6');expect(html).toContain('view=tasks');expect(html).toContain('authenticated user explicitly promoted');expect(html).not.toContain('Promotion is explicit and becomes available in a later phase');
  });
});
