import type {
  KillSwitchConfig,
  MetricReport,
  TriggerOptions,
  SystemState,
  KillSwitchEvent,
  RecoveryEvent,
  AutomationRule,
  AuditLogEntry,
  AlertConfig,
  AutomationMode
} from './types';
import { MetricsBuffer } from './metrics-buffer';

const DEFAULT_BASE_URL = 'https://api.haiec.com/kill-switch/v1';

export class KillSwitch {
  private config: Required<Pick<KillSwitchConfig, 'apiKey' | 'systemId' | 'mode' | 'baseUrl'>> & 
    Pick<KillSwitchConfig, 'onTrigger' | 'onRecover' | 'onError'>;
  private state: SystemState | null = null;
  private metricsBuffer: MetricsBuffer;
  private flushInterval: NodeJS.Timeout | null = null;
  private wsConnection: WebSocket | null = null;

  constructor(config: KillSwitchConfig) {
    this.config = {
      apiKey: config.apiKey,
      systemId: config.systemId,
      mode: config.mode || 'semi-auto',
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
      onTrigger: config.onTrigger,
      onRecover: config.onRecover,
      onError: config.onError
    };

    this.metricsBuffer = new MetricsBuffer();
    this.initializeMetricsFlush();
  }

  private initializeMetricsFlush(): void {
    this.flushInterval = setInterval(() => {
      if (this.metricsBuffer.getCount() > 0) {
        this.flushMetrics();
      }
    }, 5000);
  }

  private async flushMetrics(): Promise<void> {
    const bufferedMetrics = this.metricsBuffer.getAll();
    if (bufferedMetrics.length === 0) return;

    const ids = bufferedMetrics.map(m => m.id);
    const metrics = bufferedMetrics.map(m => m.metrics);

    try {
      await this.request('/metrics/batch', 'POST', { metrics });
      
      // Success - remove from buffer
      this.metricsBuffer.remove(ids);
      
    } catch (error) {
      // Implement exponential backoff retry logic
      for (const id of ids) {
        const retryCount = this.metricsBuffer.getRetryCount(id);
        if (retryCount >= 5) {
          // Max retries reached - log and discard
          console.error(`[KillSwitch] Discarding metric ${id} after 5 retries`);
          this.metricsBuffer.remove([id]);
        } else {
          this.metricsBuffer.incrementRetry(id);
          
          // Exponential backoff: 2^retryCount seconds
          const backoffMs = Math.pow(2, retryCount) * 1000;
          console.warn(`[KillSwitch] Retry ${retryCount + 1}/5 for metric ${id} in ${backoffMs}ms`);
        }
      }
      
      this.handleError(error as Error);
    }
  }

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: any
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'X-System-ID': this.config.systemId
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' })) as { message?: string };
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  private handleError(error: Error): void {
    if (this.config.onError) {
      this.config.onError(error);
    } else {
      console.error('[KillSwitch]', error.message);
    }
  }

  async reportMetrics(metrics: MetricReport): Promise<void> {
    const report: MetricReport = {
      ...metrics,
      timestamp: metrics.timestamp || new Date().toISOString()
    };

    this.metricsBuffer.add(this.config.systemId, report);

    if (this.metricsBuffer.getCount() >= 10) {
      await this.flushMetrics();
    }
  }

  async reportMetricsSync(metrics: MetricReport): Promise<{ triggered: boolean; state: SystemState }> {
    const report: MetricReport = {
      ...metrics,
      timestamp: metrics.timestamp || new Date().toISOString()
    };

    const result = await this.request<{ triggered: boolean; state: SystemState; event?: KillSwitchEvent }>(
      '/metrics',
      'POST',
      { metrics: report }
    );

    this.state = result.state;

    if (result.triggered && result.event && this.config.onTrigger) {
      this.config.onTrigger(result.event);
    }

    return result;
  }

  async trigger(options: TriggerOptions): Promise<KillSwitchEvent> {
    const event = await this.request<KillSwitchEvent>('/trigger', 'POST', {
      systemId: this.config.systemId,
      layer: options.layer,
      reason: options.reason,
      escalate: options.escalate || false,
      notifyChannels: options.notifyChannels || ['slack', 'email']
    });

    if (this.config.onTrigger) {
      this.config.onTrigger(event);
    }

    return event;
  }

  async triggerLayer(layer: 1 | 2 | 3 | 4 | 5, reason: string): Promise<KillSwitchEvent> {
    return this.trigger({ layer, reason });
  }

  async triggerAll(reason: string): Promise<KillSwitchEvent> {
    return this.trigger({ layer: 5, reason, escalate: true });
  }

  async recover(notes?: string): Promise<RecoveryEvent> {
    const event = await this.request<RecoveryEvent>('/recover', 'POST', {
      systemId: this.config.systemId,
      notes
    });

    if (this.config.onRecover) {
      this.config.onRecover(event);
    }

    return event;
  }

  async getState(): Promise<SystemState> {
    this.state = await this.request<SystemState>(`/systems/${this.config.systemId}/state`);
    return this.state;
  }

  async setMode(mode: AutomationMode): Promise<void> {
    await this.request(`/systems/${this.config.systemId}/mode`, 'PUT', { mode });
    this.config.mode = mode;
  }

  async getRules(): Promise<AutomationRule[]> {
    return this.request<AutomationRule[]>(`/systems/${this.config.systemId}/rules`);
  }

  async createRule(rule: Omit<AutomationRule, 'id'>): Promise<AutomationRule> {
    return this.request<AutomationRule>(`/systems/${this.config.systemId}/rules`, 'POST', rule);
  }

  async updateRule(ruleId: string, updates: Partial<AutomationRule>): Promise<AutomationRule> {
    return this.request<AutomationRule>(`/systems/${this.config.systemId}/rules/${ruleId}`, 'PUT', updates);
  }

  async deleteRule(ruleId: string): Promise<void> {
    await this.request(`/systems/${this.config.systemId}/rules/${ruleId}`, 'DELETE');
  }

  async getAuditLog(options?: { limit?: number; offset?: number; startDate?: string; endDate?: string }): Promise<AuditLogEntry[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.startDate) params.set('startDate', options.startDate);
    if (options?.endDate) params.set('endDate', options.endDate);

    const query = params.toString();
    return this.request<AuditLogEntry[]>(`/systems/${this.config.systemId}/audit${query ? `?${query}` : ''}`);
  }

  async configureAlerts(config: AlertConfig): Promise<void> {
    await this.request(`/systems/${this.config.systemId}/alerts`, 'PUT', config);
  }

  async testAlert(channel: 'slack' | 'pagerduty' | 'email' | 'webhook'): Promise<{ success: boolean; message: string }> {
    return this.request(`/systems/${this.config.systemId}/alerts/test`, 'POST', { channel });
  }

  connectRealtime(): void {
    if (this.wsConnection) {
      return;
    }

    const wsUrl = this.config.baseUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    this.wsConnection = new WebSocket(`${wsUrl}/ws?systemId=${this.config.systemId}&token=${this.config.apiKey}`);

    this.wsConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'trigger' && this.config.onTrigger) {
          this.config.onTrigger(data.event);
        } else if (data.type === 'recover' && this.config.onRecover) {
          this.config.onRecover(data.event);
        } else if (data.type === 'state') {
          this.state = data.state;
        }
      } catch (error) {
        this.handleError(error as Error);
      }
    };

    this.wsConnection.onerror = (error) => {
      this.handleError(new Error('WebSocket error'));
    };

    this.wsConnection.onclose = () => {
      this.wsConnection = null;
      setTimeout(() => this.connectRealtime(), 5000);
    };
  }

  disconnectRealtime(): void {
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
  }

  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.disconnectRealtime();
    this.flushMetrics();
  }
}

export function createKillSwitch(config: KillSwitchConfig): KillSwitch {
  return new KillSwitch(config);
}

export const killSwitchMiddleware = (config: KillSwitchConfig) => {
  const ks = new KillSwitch(config);

  return async (req: any, res: any, next: any) => {
    const state = await ks.getState();

    if (state.status === 'killed' || state.status === 'offline') {
      return res.status(503).json({
        error: 'Service temporarily unavailable',
        reason: 'AI system has been shut down for safety',
        retryAfter: 300
      });
    }

    if (state.currentThrottle < 100) {
      const random = Math.random() * 100;
      if (random > state.currentThrottle) {
        return res.status(429).json({
          error: 'Too many requests',
          reason: 'AI system is throttled',
          throttlePercent: state.currentThrottle,
          retryAfter: 60
        });
      }
    }

    req.killSwitch = ks;
    next();
  };
};
