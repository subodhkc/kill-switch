# HAIEC Kill Switch SDK

**Application-level AI kill switch with audit-grade evidence**

## Definition

**L3 = Application-level "AI Execution Stop"**

It stops AI execution paths (LLM calls, tool calls, agent loops) by failing closed at a central guard. It is NOT infrastructure shutdown, network isolation, or secrets revocation.

### Customer-True Claim

> "We can stop AI execution at the application layer within seconds, with human override, RBAC, audit trail, drill mode, and time-to-effect evidence."

## Overview

HAIEC Kill Switch provides real-time intervention and documented override for AI systems. It supports EU AI Act human-oversight readiness with:

- **Layer 1 (Rate Limiting)**: Throttle AI requests from 100% → 50% → 25% → 0%
- **Layer 2 (Circuit Breaker)**: Open circuit to block new requests, route to fallback
- **Layer 3 (AI Execution Stop)**: Central guard blocks all AI execution paths ✅ **NEW**

### Roadmap (Future Enhancement)
- Layer 4: Network Block (firewall rules)
- Layer 5: Database Revoke (credential revocation)

## Features

### Available Now
- ✅ Manual and automated trigger/recover (L1-L2)
- ✅ **L3 AI Execution Stop** (manual-only, RBAC-protected)
- ✅ **Central enforcement guard** (`assertAiExecutionAllowed`)
- ✅ **Time-to-effect evidence** (triggeredAt → effectiveAt → timeToEffectMs)
- ✅ **Drill mode** (test without state change)
- ✅ Three automation modes (Manual, Semi-Auto, Full-Auto)
- ✅ RBAC (admin/operator/viewer roles)
- ✅ Audit logging with export (JSON/CSV)
- ✅ Notification queue (Slack, PagerDuty, Webhook, Email)
- ✅ Real-time dashboard
- ✅ Metric-based automation rules
- ✅ Idempotency + cooldown protection

### RBAC Roles
| Role | Permissions |
|------|-------------|
| **admin** | trigger, recover, view, config |
| **operator** | view, request |
| **viewer** | view only |

## L3 Central Enforcement Guard

The guard is the core of L3 - call it before any AI execution:

```typescript
import { 
  assertAiExecutionAllowed, 
  withKillSwitchGuard,
  KillSwitchTriggeredError 
} from '@haiec/kill-switch'

// Option 1: Direct assertion
try {
  await assertAiExecutionAllowed({
    systemId: 'hiring-ai-prod',
    operationType: 'LLM_CALL',
    endpoint: '/api/chat',
    actorApiKeyId: 'key_123',
    requestId: 'req_456'
  })
  // Proceed with AI call
  const response = await openai.chat.completions.create(...)
} catch (error) {
  if (error instanceof KillSwitchTriggeredError) {
    // AI execution blocked - return fallback
    return { error: 'AI temporarily unavailable', reason: error.killReason }
  }
  throw error
}

// Option 2: Wrapper function
const response = await withKillSwitchGuard(
  { systemId: 'hiring-ai-prod', operationType: 'LLM_CALL' },
  () => openai.chat.completions.create(...)
)
```

### Coverage Targets (Minimum)
- LLM call wrapper(s)
- Tool execution entrypoints
- Agent loop tick / step execution
- Webhook routes that trigger AI behavior
- Background jobs that invoke AI

## Quick Start

```typescript
import { KillSwitch, createKillSwitch } from '@haiec/kill-switch'

const killSwitch = createKillSwitch({
  apiKey: process.env.HAIEC_API_KEY,
  systemId: 'hiring-ai-prod',
  mode: 'semi-auto'
})

// Report metrics
await killSwitch.reportMetrics({
  accuracy: 0.92,
  biasScore: 0.08,
  latencyP95: 1.2
})

// Manual L3 trigger (requires admin role)
await killSwitch.trigger({
  layer: 3,
  reason: 'Critical bias detected - stopping all AI execution',
  escalate: true
})

// Recover (requires admin role + recoveryReason)
await killSwitch.recover({
  recoveryReason: 'Bias issue resolved after model update'
})
```

## Drill Mode

Test your kill switch without affecting production:

```typescript
// Trigger a drill
await fetch('/api/kill-switch/trigger', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}` },
  body: JSON.stringify({
    systemId: 'hiring-ai-prod',
    layer: 3,
    reason: 'Quarterly drill - testing L3 response',
    isDrill: true  // No actual state change
  })
})
```

Drill events:
- ✅ Write audit log + event (marked DRILL)
- ✅ Send notifications (marked [DRILL])
- ❌ Do NOT change executionState
- ❌ Do NOT block AI execution

**Recommended cadence**: Quarterly drill; evidence export retained.

## API Endpoints

| Endpoint | Method | Description | RBAC |
|----------|--------|-------------|------|
| `/api/kill-switch/systems` | GET | List systems | viewer+ |
| `/api/kill-switch/systems` | POST | Create system | admin |
| `/api/kill-switch/trigger` | POST | Trigger kill switch | admin |
| `/api/kill-switch/recover` | POST | Recover system | admin |
| `/api/kill-switch/metrics` | POST | Report metrics | operator+ |
| `/api/kill-switch/systems/[id]/audit` | GET | Get audit logs | viewer+ |
| `/api/kill-switch/systems/[id]/audit/export` | GET | Export evidence | viewer+ |

## Audit Export

Export audit logs for compliance evidence:

```bash
# JSON format with events and time-to-effect stats
curl -H "Authorization: Bearer $API_KEY" \
  "https://api.haiec.com/api/kill-switch/systems/{systemId}/audit/export?format=json&includeEvents=true"

# CSV format
curl -H "Authorization: Bearer $API_KEY" \
  "https://api.haiec.com/api/kill-switch/systems/{systemId}/audit/export?format=csv"
```

Export includes:
- Trigger events (manual vs drill)
- Recovery events
- Blocked attempts (rate-limited)
- Time-to-effect metrics
- Actor identifiers + IP + request IDs

## Time-to-Effect Evidence

Critical for sales demos and audits:

```json
{
  "summary": {
    "timeToEffectStats": {
      "count": 5,
      "avgMs": 850,
      "minMs": 420,
      "maxMs": 1200
    }
  }
}
```

Demo script: "Triggered at 10:01:05, effective at 10:01:06, 900ms."

## Data Model

### KillSwitchSystem (L3 Fields)
| Field | Type | Description |
|-------|------|-------------|
| `executionState` | OPEN \| KILLED | Current L3 state |
| `killedAt` | DateTime? | When killed |
| `killedByApiKeyId` | String? | Actor identifier |
| `killReason` | String? | Required for trigger |
| `killScope` | String | AI_EXECUTION (future scopes) |
| `lastStateChangeAt` | DateTime? | Last state change |
| `version` | Int | Optimistic concurrency |
| `cooldownUntil` | DateTime? | Prevents flip-flopping |

### KillSwitchEvent (Time-to-Effect)
| Field | Type | Description |
|-------|------|-------------|
| `effectiveAt` | DateTime? | First blocked attempt |
| `timeToEffectMs` | Int? | Trigger → effective delta |
| `isDrill` | Boolean | Drill mode flag |
| `eventType` | String | TRIGGER \| RECOVERY \| DRILL \| BLOCKED_ATTEMPT |

## Positioning

**HAIEC supports EU AI Act human-oversight readiness with real-time intervention and documented override for application-level controls.**

### Allowed Claims
- "Application-level AI execution stop with human override"
- "Deterministic enforcement gate for LLM/tool/agent calls"
- "Audit-grade evidence: actor, reason, timestamps, time-to-effect"
- "Drill mode supported"

### NOT Allowed Claims
- "Full system shutdown"
- "Infrastructure kill"
- "Network isolation"
- "EU AI Act compliant" (say "readiness support" unless mapped explicitly)

## Compliance Mapping

| Framework | Coverage |
|-----------|----------|
| EU AI Act Article 14 | L1-L3 human oversight |
| SOC 2 CC7.2 | System monitoring |
| ISO 27001 A.12.1.3 | Capacity management |

## Acceptance Tests

1. ✅ Trigger L3 → next AI call blocked within seconds
2. ✅ Audit log shows: actor, reason, scope, timestamps
3. ✅ EffectiveAt captured + timeToEffectMs computed
4. ✅ Recover restores normal AI execution
5. ✅ Drill produces evidence but does not change state
6. ✅ Export produces complete event trail in JSON/CSV

## License

Proprietary - HAIEC Inc.
