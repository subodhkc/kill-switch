# @haiec/kill-switch

**Enterprise-grade AI safety controls with automated compliance monitoring.**

## Use Cases

Protect your AI systems from failures and ensure regulatory compliance:

- **Production AI Safety**: Automatically throttle or halt AI systems when performance degrades
- **Compliance Automation**: EU AI Act Article 14 compliant with complete audit trails
- **Risk Mitigation**: 5-layer defense system prevents AI failures from impacting users
- **Multi-System Management**: Monitor and control multiple AI deployments from one dashboard
- **Real-time Monitoring**: Instant alerts and automated responses to threshold breaches

## Installation

```bash
npm install @haiec/kill-switch
```

## Quick Start

```typescript
import { KillSwitch } from '@haiec/kill-switch';

// Initialize
const ks = new KillSwitch({
  apiKey: process.env.KILL_SWITCH_API_KEY,
  systemId: 'hiring-ai-prod',
  mode: 'semi-auto'  // 'manual' | 'semi-auto' | 'full-auto'
});

// Report metrics from your AI system
await ks.reportMetrics({
  accuracy: 0.85,
  biasScore: 0.12,
  latencyP95: 1.5,
  errorRate: 0.02
});

// SDK automatically triggers kill switch if thresholds exceeded
// Or manually trigger:
await ks.trigger({
  layer: 2,
  reason: 'Manual intervention - suspicious pattern detected'
});

// Recover system
await ks.recover('Issue resolved - model retrained');
```

## Features

- **5-Layer Defense**: Throttling → Circuit Breaking → Process Kill → Network Block → Database Revoke
- **3 Automation Modes**: Manual, Semi-Auto (recommended), Full-Auto
- **Real-time Monitoring**: WebSocket support for instant notifications
- **Compliance Ready**: EU AI Act Article 14 compliant with audit trails
- **Framework Agnostic**: Works with any AI framework or API

## API Reference

### `new KillSwitch(config)`

```typescript
const ks = new KillSwitch({
  apiKey: string,              // Your API key
  systemId: string,            // Unique system identifier
  mode?: 'manual' | 'semi-auto' | 'full-auto',
  baseUrl?: string,            // Optional custom API URL
  onTrigger?: (event) => void, // Callback when kill switch triggers
  onRecover?: (event) => void, // Callback when system recovers
  onError?: (error) => void    // Error handler
});
```

### Methods

#### `reportMetrics(metrics)`
Report metrics (batched, async):
```typescript
await ks.reportMetrics({
  accuracy?: number,
  biasScore?: number,
  errorRate?: number,
  latencyP50?: number,
  latencyP95?: number,
  latencyP99?: number,
  throughput?: number,
  customMetrics?: Record<string, number>
});
```

#### `reportMetricsSync(metrics)`
Report metrics and get immediate response with trigger status.

#### `trigger(options)`
Manually trigger kill switch:
```typescript
await ks.trigger({
  layer: 1 | 2 | 3 | 4 | 5,
  reason: string,
  escalate?: boolean,
  notifyChannels?: ('slack' | 'pagerduty' | 'email' | 'webhook')[]
});
```

#### `triggerLayer(layer, reason)`
Shorthand to trigger specific layer.

#### `triggerAll(reason)`
Trigger all layers (full kill).

#### `recover(notes?)`
Recover system to healthy state.

#### `getState()`
Get current system state.

#### `setMode(mode)`
Change automation mode.

#### `createRule(rule)`
Create automation rule:
```typescript
await ks.createRule({
  metricName: 'accuracy',
  thresholdValue: 0.70,
  thresholdOperator: '<',
  layer1Action: 'throttle_50',
  layer2Action: 'open_circuit',
  layer3Action: 'require_approval',
  minDurationSeconds: 30,
  cooldownMinutes: 5
});
```

#### `getRules()`
List all automation rules.

#### `getAuditLog(options?)`
Get audit log entries.

#### `connectRealtime()`
Connect WebSocket for real-time updates.

## Middleware

### Express/Koa

```typescript
import { killSwitchMiddleware } from '@haiec/kill-switch';

app.use('/api/ai/*', killSwitchMiddleware({
  apiKey: process.env.KILL_SWITCH_API_KEY,
  systemId: 'hiring-ai-prod'
}));
```

Automatically blocks requests when system is killed or throttled.

## Callbacks

```typescript
const ks = new KillSwitch({
  apiKey: process.env.KILL_SWITCH_API_KEY,
  systemId: 'hiring-ai-prod',
  
  onTrigger: (event) => {
    console.log('Kill switch activated!', event);
    notifySlack(`AI system killed: ${event.reason}`);
    activateFallbackSystem();
  },
  
  onRecover: (event) => {
    console.log('System recovered', event);
    deactivateFallbackSystem();
  }
});
```

## Automation Modes

### Manual
All actions require human approval. Alerts sent but no auto-trigger.

### Semi-Auto (Recommended)
- Layers 1-2 auto-trigger (throttle, circuit break)
- Layers 3-5 require approval (kill, network block, DB revoke)
- Best balance of safety and speed

### Full-Auto
All configured layers auto-trigger. Fastest response, highest automation.

## License

MIT

## Support

- Documentation: https://haiec.com/kill-switch/docs
- Dashboard: https://haiec.com/kill-switch/dashboard
- Issues: https://github.com/subodhkc/kill-switch/issues
- Email: contact@haiec.com

---

Built by [Subodh Kc](https://subodhkc.com) — a [HAIEC](https://www.haiec.com) (Human AI Evidence Company) product.
