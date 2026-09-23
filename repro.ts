// Minimal repro: a non-forked AgentController subagent fails when the
// workspace carries a browser. No API keys: models come from a mock gateway.
//
//   npx tsx repro.ts            -> workspace WITH a browser    (fails)
//   npx tsx repro.ts nobrowser  -> same workspace, no browser  (control, passes)
//
// The controller HAS memory, so the parent's own turn works; only the
// non-forked subagent (built without memory) fails.
import { MockLanguageModelV2 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { Agent } from '@mastra/core/agent';
import { AgentController } from '@mastra/core/agent-controller';
import { MastraModelGateway } from '@mastra/core/llm';
import { InMemoryStore } from '@mastra/core/storage';
import { LocalFilesystem, Workspace } from '@mastra/core/workspace';
import { BrowserViewer } from '@mastra/browser-viewer';
import { Memory } from '@mastra/memory';

const withBrowser = process.argv[2] !== 'nobrowser';
const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
const text = (t: string) => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: t },
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: 'stop', usage },
];

// Parent: first call delegates to the "worker" subagent, second call wraps up.
let parentCalls = 0;
const parentModel = new MockLanguageModelV2({
  doStream: async () => ({
    stream: simulateReadableStream({
      chunks: (++parentCalls === 1
        ? [
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'subagent',
              input: JSON.stringify({ agentType: 'worker', task: 'Say hi.' }),
            },
            { type: 'finish', finishReason: 'tool-calls', usage },
          ]
        : text('done')) as any,
    }),
  }),
});
// Subagent: just answers.
const childModel = new MockLanguageModelV2({
  doStream: async () => ({ stream: simulateReadableStream({ chunks: text('hi') as any }) }),
});

class MockGateway extends MastraModelGateway {
  readonly id = 'mock';
  readonly name = 'Mock';
  async fetchProviders() {
    return {
      mock: { name: 'Mock', models: ['parent', 'child'], apiKeyEnvVar: 'MOCK_API_KEY', gateway: 'mock' },
    };
  }
  buildUrl() {
    return undefined;
  }
  async getApiKey() {
    return 'not-used';
  }
  resolveLanguageModel({ modelId }: { modelId: string }) {
    return modelId.endsWith('child') ? childModel : parentModel;
  }
}

const controller = new AgentController({
  id: 'repro',
  agent: new Agent({ id: 'parent', name: 'Parent', instructions: 'Delegate.', model: 'mock/parent' }),
  modes: [{ id: 'default', name: 'Default', defaultModelId: 'mock/parent' }],
  defaultModeId: 'default',
  storage: new InMemoryStore(),
  memory: new Memory({ storage: new InMemoryStore() }),
  gateways: [new MockGateway()],
  subagents: [
    {
      id: 'worker',
      name: 'Worker',
      description: 'Does a small task.',
      instructions: 'Answer briefly.',
      defaultModelId: 'mock/child',
      // forked is false by default: a separate specialist agent
    },
  ],
  workspace: new Workspace({
    id: 'ws',
    filesystem: new LocalFilesystem({ basePath: process.cwd() }),
    // BrowserViewer launches Chrome lazily; nothing here launches it.
    ...(withBrowser ? { browser: new BrowserViewer({ cli: 'agent-browser' }) } : {}),
  }),
});

await controller.init();
const session = await controller.createSession({ resourceId: 'user-1' });
const events: any[] = [];
session.subscribe((e: any) => {
  events.push(e);
  if (e.type === 'tool_approval_required') session.respondToToolApproval({ decision: 'approve' });
});
await session.thread.create({ title: 'repro' });
await session.sendMessage({ content: 'Delegate to the worker.' });

if (process.env.DEBUG_EVENTS) for (const e of events) console.log(e.type, JSON.stringify(e).slice(0, 300));
const end = events.find(e => e.type === 'subagent_end');
console.log(`workspace browser: ${withBrowser ? 'yes' : 'no'}`);
console.log('subagent_start seen:', events.some(e => e.type === 'subagent_start'));
console.log('subagent_end:', end && { isError: end.isError, result: String(end.result ?? '').slice(0, 300) });
await controller.destroy();
process.exit(0);
