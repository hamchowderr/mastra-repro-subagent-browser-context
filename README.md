# Repro: non-forked AgentController subagent fails when the workspace has a browser

`@mastra/core` 1.69.0 · `@mastra/memory` 1.31.0 · `@mastra/browser-viewer` 0.2.4 · Node 24.16.0

No API keys. A mock gateway returns AI SDK `MockLanguageModelV2` models. Chrome is never launched: `BrowserViewer` only launches on first browser use, and nothing here uses the browser.

## Run

```bash
npm install
npm run repro     # workspace WITH a browser
npm run control   # same code, workspace WITHOUT a browser
```

## Expected

Both runs: `subagent_end: { isError: false, result: 'hi' }`

## Actual

`npm run repro`:

```
workspace browser: yes
subagent_start seen: true
subagent_end: {
  isError: true,
  result: '[Processor:browser-context] computeStateSignal requires Mastra memory with an active resourceId and threadId'
}
```

`npm run control`:

```
workspace browser: no
subagent_start seen: true
subagent_end: { isError: false, result: 'hi' }
```

The controller has memory configured, so the parent agent's own turn succeeds. Only the non-forked subagent fails. Setting `forked: true` on the subagent makes the same run succeed.

`DEBUG_EVENTS=1 npm run repro` prints every controller event.
