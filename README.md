# Codebreakdown

A focused web app for understanding code. Connect an LLM API key, import a repository or local source files, and follow a walkthrough with synchronized translucent source highlights and explanation blocks.

## Run locally

Requires Node.js 22.13 or later and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by the server. No server-side LLM key or database is required. Each user supplies their own key in the app. The initial workspace contains a clearly marked, prerecorded example; it works without credentials.

```sh
npm test          # API and validation tests using mocked upstream services
npm run lint
npx tsc --noEmit
npm run build     # Cloudflare Worker + browser assets
npm start         # Serve the production build with Wrangler
```

## Use

1. Enter an API key. Recognizable prefixes detect OpenAI, Anthropic, Google Gemini, or OpenRouter; select the provider manually for ambiguous keys. Click **Connect** to retrieve live models, then select a model.
2. Enter a public GitHub repository URL and use the arrow, upload one or more text files, or browse a folder.
3. Repository imports open a file-by-file overview and automatically analyze it if a model is connected. Otherwise, connect and press **Analyze**. Each entry describes the file's likely role and relationships, **inferred from its path**, without reading its contents. Binary assets and configuration files also receive overview entries.
4. Select a file to fetch its contents and generate its code explanation. For uploaded files, press **Analyze** after import. The **Overview** entry returns to the existing file map; Analyze regenerates it using the current question.
5. Leave **Question** empty to explain the complete file. A question focuses the walkthrough on relevant behavior. Click explanation blocks to highlight source lines, or use play/pause, previous/next, restart, speed, and optional spoken narration.
6. **Guide** opens all usage explanations; the main workspace uses small field labels and controls.

## Providers

| Provider      | Detection                                                      | Discovery                                                                | Analysis                      |
| ------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| OpenAI        | `sk-proj-`, `sk-svcacct-`; manual for legacy or ambiguous keys | Live `/v1/models`, text model filter                                     | Responses API, `store: false` |
| Anthropic     | `sk-ant-`                                                      | Paginated `/v1/models`                                                   | Messages API                  |
| Google Gemini | `AIza`                                                         | Paginated `/v1beta/models`, `generateContent` filter                     | Generate Content API          |
| OpenRouter    | `sk-or-v1-`                                                    | Key validation via `/api/v1/key`; text models from `/api/v1/models/user` | Chat Completions API          |

Key prefixes are hints, not authentication or proof of ownership. The app never probes multiple providers with the same key. Connect validates only the explicitly selected provider. Model discovery does not guarantee sufficient billing quota, generation permissions, context capacity, or JSON reliability. Unsupported or incomplete generations produce errors rather than fabricated walkthroughs. The provider list is intentionally limited to these four; arbitrary custom endpoints are not accepted.

Official API references: [OpenAI model discovery](https://developers.openai.com/api/reference/resources/models/methods/list), [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create), [Anthropic models](https://platform.claude.com/docs/en/api/models/list), [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [Gemini models](https://ai.google.dev/api/models), [Gemini generation](https://ai.google.dev/api/generate-content).

OpenRouter model discovery respects the account’s provider preferences and includes compatible free and paid models. Namespaced model IDs and `:free` variants are supported. OpenRouter receives the request and routes code to the chosen upstream model provider; both services’ policies apply. A valid key does not guarantee credits or access to every model.

OpenRouter references: [key validation](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key), [account-filtered model discovery](https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails), [completion format](https://openrouter.ai/docs/api/reference/overview).

## Behavior and limits

- Public GitHub repositories only, repository-root URLs, default branch. Imports pin blob hashes, so later branch changes do not change selected file content. GitHub API rate limits apply; the app does not accept a GitHub token or access private repos. See [GitHub tree API](https://docs.github.com/en/rest/git/trees).
- Up to **1,500 files** per workspace; complete repository trees only. Truncated or larger repositories are rejected explicitly instead of silently skipping files. Git submodules are not traversed.
- **120 KB per UTF-8 text file**, **12 MB per local import**, and **4,000 characters per question**. Binary/non-UTF-8 files cannot be analyzed. Request bodies and upstream responses are bounded to protect memory.
- Overview requests run in batches of 40 paths. Every requested file must appear exactly once. Overviews use path metadata; they are useful navigation aids, not content-grounded reviews.
- Large files split into sections of about 20,000 characters or 250 lines, preserving absolute line numbers. Each section receives repository paths and earlier section summaries. Every line must be covered in whole-file mode; focused answers may select subsets. Multi-section requests cost more and can hit provider or platform timeouts. Very long individual lines remain intact.
- Analysis knows the selected file and repository paths, not other files' contents. Cross-file relationships are inferred unless visible in the selected source. It does not claim to resolve a complete dependency graph.
- Mobile layouts (up to 800px wide) use compact code text (7px with 11px line spacing at default browser settings), 11px explanations, and tighter card spacing to reduce scrolling. Browser text scaling remains available.
- Playback follows the selected blocks. With voice enabled, the browser's speech synthesis advances on utterance completion; otherwise a reading timer advances the walkthrough. Speech availability and voices depend on the browser/OS. No audio files are stored.
- Cancel stops the app request; a provider may still finish processing or bill an already accepted request. Partial repository batches and partial file analyses are not presented as complete results.
- Analysis is AI-generated and can be wrong, even when its structure validates. Generated strings are rendered as text, never HTML. Uploaded source is never executed.

## Privacy and security

Keys, file contents, and analyses stay in browser memory and transient request memory, with no local storage, cookies owned by the app, or app database persistence. Refreshing clears the workspace. The app uses same-origin POST endpoints; the server forwards a key only to the selected provider's fixed HTTPS endpoint. Secrets are not placed in URLs, logs, or error messages. Do not add request-body logging at the reverse proxy.

The selected provider receives source code, repository paths, and the question. Its billing and retention policies apply; `store: false` is not a promise of zero provider retention. The operating system's speech service may receive explanation text. Sites hosting can use its own sign-in session. Only import code you intend to share with the selected provider, and avoid including credentials in source files.

The private Sites deployment is owner-only by default. If deploying publicly, add authenticated sessions, per-user request limits, and abuse controls first. There is no app-level authentication or distributed rate limiting in the source; an internet-facing public proxy would allow abuse of the GitHub endpoint even without an LLM key.

## Architecture

- `app/page.tsx`, `app/globals.css`: React workspace, file explorer, source rendering, narration, and Guide.
- `app/api/models`: live provider discovery.
- `app/api/repository`: public GitHub tree and pinned blob retrieval.
- `app/api/analyze`: file and repository orchestration.
- `lib/providers.ts`: fixed-endpoint provider adapters.
- `lib/analysis.ts`: output validation and source chunking.
- `lib/server.ts`: bounded requests/responses and safe errors.
- `tests/core.test.mjs`: meaningful adapter, route, input-limit, and output-contract tests with mocked upstreams; no paid model calls.

Stack: React 19, TypeScript, Vinext/Vite, Cloudflare Workers, Lucide icons, and the Sites scaffold with shadcn tooling. `.openai/hosting.json` identifies the private Sites project. The GitHub origin remains the user's repository.

An optional, feature-detected WebMCP `select_walkthrough_block` tool uses the same visible selection state. It exposes no key and makes no provider requests. It is not required for normal use. Registration and execution need a supported WebMCP browser; that browser-specific contract has not been verified in this environment.

## “Test run” feasibility and proposed design

**Feasible, but not implemented in this version.** Static explanation and actual execution should be visibly distinct. An LLM predicting a result is not a test run.

A useful first implementation would support small Python and JavaScript/TypeScript projects, pure functions, and existing test suites. General repositories can depend on databases, credentials, native libraries, GPUs, operating systems, or external APIs; many cannot be reproduced automatically. Report those as unsupported or incomplete rather than passed.

Proposed flow:

1. Inspect manifests and existing tests without executing installation hooks. The model proposes a test plan with inputs, assertions, runtime, dependencies, and explicit assumptions.
2. Show the plan and commands for the user to start. Copy only chosen code into a new disposable sandbox, excluding all LLM keys and application secrets.
3. Provision an isolated Linux VM or a comparably isolated execution service. Apply CPU, memory, disk, output, wall-clock, and concurrency caps. Deny network by default; use controlled dependency retrieval when explicitly needed. Never mount the host filesystem or Docker socket.
4. Run real tests, capture exit status/stdout/stderr, and retain the exact tests and runtime versions. Bound the output and destroy the environment on completion, error, cancellation, or timeout.
5. Ask the model to explain the observed results. Link stack traces, assertions, and coverage locations to the existing source/highlight panels. Distinguish **Passed**, **Failed**, **Timed out**, **Unsupported**, and **Not run**. Passing tests support only the tested assertions.

A managed service such as [E2B](https://docs.e2b.dev/sandbox) supplies isolated Linux VMs and lifecycle controls. [Cloudflare Sandbox SDK](https://developers.cloudflare.com/sandbox/) is another execution-oriented option; the current ordinary Worker is not a general-purpose process sandbox. Either needs separate service provisioning, credentials/billing, runtime configuration, and cleanup guarantees. The LLM key alone does not provision execution infrastructure.

Recommended first scope: one language/runtime at a time, existing tests first, then generated edge-case tests; no automatic dependency installation from untrusted scripts. Implement an execution-service adapter behind a job queue with a server-owned credential, expiring job records, and streaming logs. Add authentication and cost limits before sharing access. Do not run arbitrary uploaded code with `eval`, a browser iframe, Node `vm`, or a process on the application server and call it securely sandboxed.

## macOS launchd and LAN access

Install the built app as a per-user LaunchAgent:

```sh
./launchd/control.sh install
./launchd/control.sh status
./launchd/control.sh logs
```

The installer builds the app, discovers the local Node executable, and writes `~/Library/LaunchAgents/com.jay.codebreakdown.plist`. It starts immediately, starts again when you log in, and restarts on unexpected exits. This is a user login service; it does not run while logged out, and the Mac must be awake for LAN access.

The app listens on **all network interfaces, port 8788**, using the built Cloudflare Worker and static assets in Wrangler's local runtime. No cloud service or Cloudflare login is needed to serve it. The debugging listener is restricted to loopback. On this Mac, use `http://jmini.local:8788` from another device on the same LAN, or the Mac's current LAN IP if that device does not resolve `.local` names.

This local instance has no login and uses HTTP. Devices that can reach the port can use it; API keys and code sent across the LAN are not transport-encrypted. Use a trusted LAN and do not forward this port to the internet. The private hosted Sites instance has separate access controls.

```sh
./launchd/control.sh restart
./launchd/control.sh stop
./launchd/control.sh start
./launchd/control.sh uninstall
```

Logs are in `~/Library/Logs/Codebreakdown/`. After code changes, run `./launchd/control.sh install` again to rebuild and restart. To change ports, reinstall with `CODEBREAKDOWN_PORT=8789 ./launchd/control.sh install`. Keep the project directory and its dependencies in place; the service runs from this checkout. If the macOS firewall prompts for Node or the Worker runtime, allow incoming connections for LAN access.
