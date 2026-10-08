export type AutomationMode = 'manual' | 'semi-auto' | 'full-auto';

export type KillSwitchLayer = 1 | 2 | 3 | 4 | 5;

export type MetricOperator = '<' | '>' | '<=' | '>=';

export type SystemStatus = 'healthy' | 'degraded' | 'throttled' | 'killed' | 'offline';

export interface KillSwitchConfig {
  apiKey: string;
  systemId: string;
  mode?: AutomationMode;
  baseUrl?: string;
  onTrigger?: (event: KillSwitchEvent) => void;
  onRecover?: (event: RecoveryEvent) => void;
  onError?: (error: Error) => void;
}

export interface MetricReport {
  accuracy?: number;
  biasScore?: number;
  errorRate?: number;
  latencyP50?: number;
  latencyP95?: number;
  latencyP99?: number;
  throughput?: number;
  customMetrics?: Record<string, number>;
  timestamp?: string;
}

export interface AutomationRule {
  id: string;
  metricName: string;
  thresholdValue: number;
  thresholdOperator: MetricOperator;
  layer1Action?: LayerAction;
  layer2Action?: LayerAction;
  layer3Action?: LayerAction;
  layer4Action?: LayerAction;
  layer5Action?: LayerAction;
  minDurationSeconds?: number;
  cooldownMinutes?: number;
  enabled: boolean;
}

export type LayerAction = 
  | 'throttle_100'
  | 'throttle_50'
  | 'throttle_25'
  | 'throttle_0'
  | 'open_circuit'
  | 'close_circuit'
  | 'kill_process'
  | 'block_network'
  | 'revoke_db'
  | 'require_approval'
  | 'none';

export interface KillSwitchEvent {
  eventId: string;
  systemId: string;
  triggeredAt: string;
  triggeredBy: 'automation' | 'manual';
  triggeredByUser?: string;
  reason: string;
  layersActivated: KillSwitchLayer[];
  metrics: MetricReport;
  ruleId?: string;
}

export interface RecoveryEvent {
  eventId: string;
  systemId: string;
  recoveredAt: string;
  recoveredBy: string;
  previousStatus: SystemStatus;
  newStatus: SystemStatus;
  notes?: string;
}

export interface SystemState {
  systemId: string;
  status: SystemStatus;
  currentThrottle: number;
  circuitBreakerState: 'closed' | 'open' | 'half-open';
  activeLayers: KillSwitchLayer[];
  lastMetrics?: MetricReport;
  lastUpdated: string;
}

export interface TriggerOptions {
  layer: KillSwitchLayer;
  reason: string;
  escalate?: boolean;
  notifyChannels?: ('slack' | 'pagerduty' | 'email' | 'webhook')[];
}

export interface AuditLogEntry {
  id: string;
  systemId: string;
  timestamp: string;
  action: 'trigger' | 'recover' | 'config_change' | 'metric_report';
  actor: string;
  details: Record<string, any>;
  ipAddress?: string;
}

export interface AlertConfig {
  slack?: {
    webhookUrl: string;
    channel?: string;
    mentionUsers?: string[];
  };
  pagerduty?: {
    integrationKey: string;
    severity?: 'critical' | 'error' | 'warning' | 'info';
  };
  email?: {
    recipients: string[];
    sendOnTrigger?: boolean;
    sendOnRecover?: boolean;
  };
  webhook?: {
    url: string;
    headers?: Record<string, string>;
  };
}

export interface DashboardStats {
  totalSystems: number;
  healthySystems: number;
  degradedSystems: number;
  killedSystems: number;
  triggersLast24h: number;
  triggersLast7d: number;
  avgResponseTimeMs: number;
}
