# Montis MCP Resources

Public resource repository for the **Montis.icu Model Context Protocol (MCP) interface**.

This repository is intentionally separate from the Montis Python coaching engine and from the private Cloudflare Edge implementation.

## What this repository contains

Montis exposes a hosted MCP service at:

`https://montis.icu/mcp`

Human-readable MCP documentation is available at:

`https://montis.icu/mcp/docs`

This repository contains the public knowledge and instruction resources consumed by that hosted MCP service. It does **not** contain the MCP server implementation, authentication layer, Cloudflare configuration, credentials, KV/D1 state, or other private hosted-service infrastructure.

## Architecture boundary

```text
Intervals.icu
    ↓
Montis Cloudflare Edge Services       [private]
    ├─ OAuth / sessions
    ├─ REST API
    ├─ MCP protocol + tool dispatch
    ├─ Intervals.icu data acquisition
    ├─ entitlement / service governance
    └─ Railway invocation
            ↓
Montis Python Engine                  [MIT]
            ↓
Governed semantic coaching output

MCP knowledge resources
    ↑
this repository                      [public]
```

The MCP interface is an Edge capability. The Montis Python engine does not implement the MCP protocol itself.

## MCP endpoint

The production MCP endpoint is:

```text
https://montis.icu/mcp
```

Transport: **Streamable HTTP**

### Authentication

OAuth (authorization code with PKCE `S256`) is handled by the hosted Montis Edge service. Discovery metadata is published at the standard well-known paths (`/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`, also under `/mcp/`).

Supported AI clients identify themselves with a **Client ID Metadata Document (CIMD)**, so no client ID has to be entered when adding the connector. The server advertises `client_id_metadata_document_supported: true` and accepts these metadata documents, each only with its own redirect:

| Client | Client ID (metadata document URL) | Redirect |
|---|---|---|
| ChatGPT | `https://chatgpt.com/oauth/client.json` | `https://chatgpt.com/connector_platform_oauth_redirect` |
| Claude (web, desktop, mobile) | `https://claude.ai/oauth/mcp-oauth-client-metadata` | `https://claude.ai/api/mcp/auth_callback` |
| Claude Code | `https://claude.ai/oauth/claude-code-client-metadata` | `http://localhost:<port>/callback` (any local port) |

Other MCP clients, and connections set up before CIMD, keep using the predefined public client (no client secret):

```text
intervals-mcp
```

The MCP service currently exposes the standard protocol operations used by supported clients, including:

- `initialize`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- `prompts/list`
- `prompts/get`

For current connection and testing instructions, see the hosted documentation at `https://montis.icu/mcp/docs`.

## Public MCP resources

The Montis MCP service uses these public knowledge resources:

| MCP resource URI | Repository file | Purpose |
|---|---|---|
| `knowledge://system/tooling` | `tools_mcp.md` | Tool orchestration rules and execution semantics |
| `knowledge://training/workout-builder` | `workoutsv2.md` | Workout generation and interval construction rules |
| `knowledge://coaching/question-bank` | `question_bank_coaching.md` | Adaptive coaching prompts and questioning logic |
| `knowledge://coaching/decision-tree` | `question_bank_what_next.md` | Progression and follow-up coaching decision logic |
| `knowledge://coaching/montis-icu-skill` | `montis_icu_claude_skill_mcp_resource.md` | Montis coaching-analysis guidance for MCP-capable AI clients |

These files are runtime knowledge resources. Their filenames and resource mappings should therefore be treated as stable interface contracts unless the corresponding private Edge configuration is updated at the same time.

## MCP tools

The hosted MCP service exposes Montis capabilities through tools rather than implementing coaching logic in the language model.

Tool groups include:

- governed Montis reports such as weekly, season, wellness and summary reports;
- Intervals.icu activity, wellness, profile, curve and training-plan reads;
- calendar reads and governed calendar writes/deletes;
- coached-athlete access where authorised;
- training-update checks and other Montis service functions.

The exact live tool schema is defined by the hosted service. Use `tools/list` against `https://montis.icu/mcp` or consult `https://montis.icu/mcp/docs` for the current interface.

## Relationship to the Montis Engine

The MIT-licensed Python coaching engine is maintained separately in:

`https://github.com/revo2wheels/intervalsicugptcoach-public`

The engine is responsible for deterministic coaching computation and governed semantic output. It can operate from locally acquired Intervals.icu data or from prefetched evidence supplied by the hosted Montis Edge service.

MCP is a presentation/integration layer above that engine:

```text
MCP client
   ↓
Montis Edge MCP service
   ↓
Montis APIs / Railway engine
   ↓
Governed coaching output
   ↓
AI dialogue
```

**Data access is not coaching intelligence.** MCP provides the interface; Montis provides the governed coaching intelligence behind it.

## What is not included here

The following remain private parts of the hosted Montis service and are not part of this repository:

- Cloudflare Worker implementation
- OAuth client secrets
- JWT signing secrets
- Internal service keys
- KV and D1 bindings/data
- Intervals.icu stored tokens
- browser session data
- webhook secrets
- hosted LLM API keys
- rate limiting, entitlement and push-notification infrastructure

No production secret values should ever be committed to this repository.

## Development rule

Changes to a resource file must remain compatible with the resource URI expected by the hosted MCP service. If a filename or resource URI changes, the corresponding Cloudflare `RESOURCE_MAP` must be updated before deployment.

## Related documentation

- Montis MCP documentation: `https://montis.icu/mcp/docs`
- Montis product: `https://www.montis.icu/`
- Montis science: `https://www.montis.icu/science.html`
- Montis technical design: `https://www.montis.icu/pipeline.html`
- Montis Python engine: `https://github.com/revo2wheels/intervalsicugptcoach-public`

## License

Unless otherwise stated in individual files, repository content is published under the repository licence. Hosted Montis services, private infrastructure, credentials, branding and service operation are not granted by the presence of these public MCP resources.
