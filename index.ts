export { KillSwitch, createKillSwitch, killSwitchMiddleware } from './client';
export * from './types';

// L3 Execution Guard - Central enforcement for AI execution
export {
  assertAiExecutionAllowed,
  withKillSwitchGuard,
  isSystemKilled,
  invalidateExecutionStateCache,
  KillSwitchTriggeredError,
  type ExecutionContext,
  type ExecutionState,
  type OperationType
} from './execution-guard';
