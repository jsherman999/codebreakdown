# Codebreakdown

A web workspace for guided code explanations. Bring an LLM API key, import code, and follow synchronized source highlights and explanation blocks.

## Development

Requires Node.js 22.13 or later.

```sh
npm install
npm run dev
```

The app uses React, TypeScript, Vinext, and Cloudflare Workers through Sites. The interface includes a prerecorded example walkthrough. Live provider and repository endpoints are being added in the next implementation change.

## Interaction

- Connect an API key, choose its provider, and load its model list.
- Import a GitHub repository, upload text files, or select a folder.
- Repository mode describes each file's role before opening individual source files.
- Leave the question empty for a whole-file explanation, or ask a focused question.
- Click blocks or use playback, previous/next, speed, and optional spoken narration.
- The Guide contains usage details; the workspace keeps explanatory UI copy minimal.

## Test run feasibility

Sandbox execution is planned separately from static explanation. A credible test run needs an isolated execution service, resource and network limits, a reproducible environment, generated tests, and actual captured results. Uploaded code must never execute on the application server. This version does not run uploaded code.
