import { afterEach, describe, expect, it } from 'vitest';
import { Agent, type AgentEvent, type AgentMessage } from '@mariozechner/pi-agent-core';
import { fauxAssistantMessage, registerFauxProvider, type FauxProviderRegistration } from '@mariozechner/pi-ai';

const registrations: FauxProviderRegistration[] = [];
const register = (tokensPerSecond?: number): FauxProviderRegistration => {
  const registration = registerFauxProvider(tokensPerSecond === undefined ? {} : { tokensPerSecond });
  registrations.push(registration);
  return registration;
};

afterEach(() => {
  for (const registration of registrations.splice(0)) registration.unregister();
});

describe('Pi 0.73.1 capability spike', () => {
  it('emits ordered native events and accepts Adapter-owned Skill context', async () => {
    const provider = register();
    provider.setResponses([
      (context) => {
        expect(context.systemPrompt).toContain('skill:read-project-metadata');
        return fauxAssistantMessage('metadata read');
      }
    ]);
    const agent = new Agent({
      initialState: {
        model: provider.getModel(),
        systemPrompt: 'skill:read-project-metadata (read-only)'
      }
    });
    const events: AgentEvent['type'][] = [];
    agent.subscribe((event) => { events.push(event.type); });

    await agent.prompt('inspect');

    expect(events[0]).toBe('agent_start');
    expect(events.at(-1)).toBe('agent_end');
    expect(events).toContain('turn_start');
    expect(events).toContain('turn_end');
    expect(agent.state.messages).toHaveLength(2);
  });

  it('propagates cancellation to the provider and reaches an aborted terminal message', async () => {
    const provider = register(20);
    provider.setResponses([fauxAssistantMessage('a deliberately slow response for cancellation verification')]);
    const agent = new Agent({ initialState: { model: provider.getModel() } });
    const pending = agent.prompt('cancel me');
    await new Promise((resolve) => setTimeout(resolve, 10));
    agent.abort();
    await pending;

    const terminal = agent.state.messages.at(-1);
    expect(terminal?.role).toBe('assistant');
    if (terminal?.role !== 'assistant') throw new Error('Expected assistant terminal message');
    expect(terminal.stopReason).toBe('aborted');
    expect(agent.state.isStreaming).toBe(false);
  });

  it('restores a durable Adapter checkpoint into a new Agent session', async () => {
    const firstProvider = register();
    firstProvider.setResponses([fauxAssistantMessage('first answer')]);
    const first = new Agent({ initialState: { model: firstProvider.getModel() }, sessionId: 'provider-cache-only' });
    await first.prompt('first question');

    const checkpoint: { schemaVersion: 1; harnessVersion: '0.73.1'; messages: AgentMessage[] } = {
      schemaVersion: 1,
      harnessVersion: '0.73.1',
      messages: structuredClone(first.state.messages)
    };
    const secondProvider = register();
    secondProvider.setResponses([
      (context) => {
        expect(context.messages).toHaveLength(3);
        return fauxAssistantMessage('resumed answer');
      }
    ]);
    const resumed = new Agent({ initialState: { model: secondProvider.getModel(), messages: checkpoint.messages } });
    await resumed.prompt('next question');

    expect(resumed.state.messages).toHaveLength(4);
    expect(first.state.messages).toHaveLength(2);
  });
});
