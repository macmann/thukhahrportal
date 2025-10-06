# Brillar HR Portal

Brillar HR Portal is an Express + Node.js application that provides employee self-service, leave tracking, and secure host-mediated agent pairing for outbound automation agents.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Data Model](#data-model)
  - [Pair Requests](#pair-requests)
  - [Pair Audit Logs](#pair-audit-logs)
- [Pairing Flow](#pairing-flow)
  - [Sequence Diagram](#sequence-diagram)
  - [API Reference](#api-reference)
  - [Rate Limits](#rate-limits)
  - [Agent Authentication (HMAC)](#agent-authentication-hmac)
  - [Curl Examples](#curl-examples)
  - [Integrating Agentic Polling](#integrating-agentic-polling)
- [Frontend Snippet](#frontend-snippet)
- [Additional Features](#additional-features)
- [Development Scripts](#development-scripts)

## Prerequisites
- Node.js 18+
- MongoDB 6+

## Quick Start
```bash
cp .env.example .env
npm install
npm run dev
```

The development server runs on `http://localhost:3000`. Update `.env` with your MongoDB credentials and pairing secrets before starting the server.

## Environment Variables
The `.env.example` file documents all supported variables. Highlights:

| Category | Variable | Description |
| --- | --- | --- |
| Server | `PORT`, `BODY_LIMIT`, `CORS_ALLOWED_ORIGINS` | Core Express configuration. Leave `CORS_ALLOWED_ORIGINS` blank to block cross-site requests by default. |
| Sessions | `SESSION_COOKIE_NAME`, `SESSION_COOKIE_SAMESITE`, `SESSION_COOKIE_MAX_AGE` | Secure SameSite cookies (defaults to `lax`) protect against CSRF. |
| Pairing | `PAIR_AGENT_ID`, `PAIR_AGENT_SECRET`, `PAIR_TOKEN_SECRET`, `PAIR_TOKEN_SCOPE`, `PAIR_TOKEN_ISSUER`, `PAIR_TOKEN_AUDIENCE` | Configure HMAC authentication for agents and JWT signing for successful claims. Secrets must be high-entropy strings. |
| Pairing TTL & Limits | `PAIR_REQUEST_TTL_MIN_SECONDS`, `PAIR_REQUEST_TTL_MAX_SECONDS`, `PAIR_POLL_LEASE_SECONDS` | Configure request lifetime (60–120s) and agent lease window. |
| Rate Limits | `PAIR_INIT_RATE_LIMIT`, `PAIR_POLL_RATE_LIMIT`, `PAIR_CLAIM_RATE_LIMIT` with matching `*_WINDOW_MS` | Per-user or per-client throttling to protect the service. |
| Replay Defence | `PAIR_AGENT_SIGNATURE_TOLERANCE_MS`, `PAIR_AGENT_REPLAY_WINDOW_MS` | Bound valid agent signatures in time and suppress replays. |

## Data Model
### Pair Requests
MongoDB collection: `pair_requests`

| Field | Type | Notes |
| --- | --- | --- |
| `_id` / `requestId` | string | Single-use identifier bound to the authenticated user. |
| `userId` | string | Host-side user initiating the pairing. |
| `clientId` | string | Logical client/partition identifier. |
| `tabId` | string \| null | Optional browser tab/session marker. |
| `scope` | string | Included in the issued JWT. |
| `status` | `pending` \| `polled` \| `claimed` | Transitioned atomically. |
| `ttlSeconds`, `createdAt`, `expiresAt` | number/date | TTL is randomized between 60–120 seconds. Documents expire automatically via TTL index. |
| `claimToken` | string | 1-time secret created when leased to an agent. |
| `polledBy`, `claimedBy` | object | Captures agent id, client instance id, and timestamp. |
| `pollLeaseExpiresAt` | date | Short lease so unresponsive agents can be superseded. |

### Pair Audit Logs
MongoDB collection: `pair_audit_logs`

| Field | Type | Description |
| --- | --- | --- |
| `requestId` | string | Foreign key to `pair_requests`. |
| `event` | string | `request.init`, `request.polled`, `request.claimed`. |
| `actor` | object | `{ type: 'user' \| 'agent', ... }`. |
| `metadata` | object | Optional request metadata (TTL, lease expiry). |
| `createdAt` | date | Indexed for chronological auditing. |

## Pairing Flow
### Sequence Diagram
```
User Browser         Host API            Agent Service
     | POST /pair/init (cookie) |                   |
     |------------------------->|                   |
     |   {request_id, ttl}      |                   |
     |<-------------------------|                   |
     |                          |  POST /pair/poll  |
     |                          |<------------------|
     |                          | {request_id,claim}|
     |                          |------------------>| POST /pair/claim
     |                          |                   |  (HMAC body)
     |                          |<------------------|
     |                          | {JWT, scope}      |
```

### API Reference
All responses are JSON unless noted. Errors follow `{ "error": string }` with status codes `400`, `401`, `404`, `410`, or `429`.

#### `POST /pair/init`
Cookie-authenticated route that creates a single-use pairing request.
- Body: `{ "client_id": string, "tab_id"?: string }`
- Success: `201` with `{ request_id, client_id, tab_id, scope, ttl_seconds, expires_at }`
- Error codes: `400` invalid input, `401` missing/invalid session, `429` rate limited.

#### `POST /pair/poll`
Agent-only polling endpoint protected with HMAC headers.
- Headers: `x-agent-id`, `x-agent-timestamp`, `x-agent-signature`
- Body: `{ "client_id": string, "client_instance_id"?: string }`
- Success: `200` with `{ request_id, claim_token, user_id, client_id, tab_id, scope, expires_at, lease_expires_at }`
  - `204 No Content` when no work is available.
- Error codes: `400`, `401`, `429`, `500`.

#### `POST /pair/claim`
Atomically claims a leased request and returns a short-lived JWT (~5 minutes).
- Headers: same as `/pair/poll`
- Body: `{ "request_id": string, "claim_token": string, "client_instance_id"?: string }`
- Success: `200` with `{ token, token_type, scope, expires_at, request, user }`
- Error codes:
  - `400` invalid payload
  - `401` bad or replayed signature
  - `404` unknown request
  - `410` expired/claimed/lease expired request
  - `429` rate limited

### Rate Limits
| Endpoint | Key | Default | Window |
| --- | --- | --- | --- |
| `/pair/init` | `user_id:client_id` | 10 requests | 60 s |
| `/pair/poll` | `client_id:client_instance_id` | 30 polls | 60 s |
| `/pair/claim` | `agent_id:request_id` | 60 claims | 60 s |

Adjust the environment variables in `.env` to tune these values.

### Agent Authentication (HMAC)
Agents must compute an HMAC SHA-256 signature over the canonical string:
```
<agent_id>:<unix_ms_timestamp>:<raw_request_body>
```
Headers sent with every poll/claim:
- `x-agent-id`: matches `PAIR_AGENT_ID`
- `x-agent-timestamp`: integer milliseconds since epoch
- `x-agent-signature`: lowercase hex digest of the HMAC using `PAIR_AGENT_SECRET`

The host validates timestamps within `PAIR_AGENT_SIGNATURE_TOLERANCE_MS` (default 2 minutes) and caches signatures for `PAIR_AGENT_REPLAY_WINDOW_MS` (default 5 minutes) to prevent replays.

### Curl Examples
```bash
# 1. Host-side init (requires session cookie from login)
curl -X POST http://localhost:3000/pair/init \
  -H "Content-Type: application/json" \
  --cookie "session_token=<cookie-value>" \
  -d '{"client_id":"web","tab_id":"tab-123"}'

# 2. Agent poll
SIGNATURE=$(node -e "const crypto=require('crypto');const secret='agent-secret';const body=JSON.stringify({client_id:'web'});const base='agent-service:'+Date.now()+':'+body;console.log(crypto.createHmac('sha256',secret).update(base).digest('hex'));" )
curl -X POST http://localhost:3000/pair/poll \
  -H "Content-Type: application/json" \
  -H "x-agent-id: agent-service" \
  -H "x-agent-timestamp: $(date +%s%3N)" \
  -H "x-agent-signature: $SIGNATURE" \
  -d '{"client_id":"web"}'
```
(Repeat the HMAC procedure for `/pair/claim` with the `request_id` and `claim_token` returned from polling.)

### Integrating Agentic Polling
1. Configure `PAIR_AGENT_SECRET` and `PAIR_TOKEN_SECRET` on both the host and agent services.
2. Long-poll `/pair/poll` with an exponential backoff if `204 No Content` is returned.
3. Cache the `claim_token` and call `/pair/claim` immediately; the lease expires after `PAIR_POLL_LEASE_SECONDS` (default 20 seconds).
4. Store the returned JWT `{ sub, user_id, aud, iss, jti, exp, scope }` and attach it as a `Bearer` token to subsequent outbound requests.
5. Monitor `pair_audit_logs` for compliance evidence and troubleshooting.

## Frontend Snippet
A minimal helper is available at `public/pairing-demo.js`:
```html
<script src="/pairing-demo.js"></script>
<script>
  async function startPairing() {
    try {
      const data = await window.requestPairing('web', 'tab-123');
      console.log('Pairing created', data);
    } catch (err) {
      console.error('Pairing failed', err);
    }
  }
</script>
```
The script uses `fetch('/pair/init')` with `credentials: 'include'` so cookies created during login are sent automatically. Combine with the secure CORS defaults (`SameSite=lax`, explicit origin allowlist) to mitigate CSRF.

## Additional Features
- CSV import for employees (`import.js`)
- MongoDB persistence via `db.js`
- SMTP notifications for leave applications
- Optional Microsoft 365 SSO

## Development Scripts
| Command | Description |
| --- | --- |
| `npm run start` | Start the production server. |
| `npm run dev` | Start the server with `nodemon`. |

Refer to `package.json` for the latest script list.
