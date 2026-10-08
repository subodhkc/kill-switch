/**
 * L3 Kill Switch - Central Enforcement Guard
 * 
 * This is the authoritative server-side guard that must be called
 * everywhere AI executes. It provides:
 * - Single source of truth for execution state
 * - Audit-grade logging of blocked attempts
 * - Time-to-effect evidence capture
 * - Rate-limited logging to prevent log spam
 */

import { prisma } from '@/lib/prisma'

// Cache for execution state (short TTL to balance performance vs freshness)
// Version tracking prevents stale reads even within TTL window
const stateCache = new Map<string, { 
  state: ExecutionState; 
  cachedAt: number;
  version: number; // Incremented on every state change
}>()
const CACHE_TTL_MS = 100 // 100ms TTL - reduced from 1000ms to minimize race condition window

// Rate limiting for blocked attempt logging
const blockedAttemptLog = new Map<string, { count: number; lastLogged: number }>()
const LOG_RATE_LIMIT_MS = 5000 // Log at most once per 5 seconds per system

export type ExecutionState = 'OPEN' | 'KILLED'

/**
 * Invalidate cache for a specific system.
 * Call this immediately after state changes to prevent stale reads.
 */
export function invalidateCache(systemId: string): void {
  stateCache.delete(systemId)
}

/**
 * Clear entire cache (for testing or emergency scenarios).
 */
export function clearCache(): void {
  stateCache.clear()
}

export type OperationType = 
  | 'LLM_CALL' 
  | 'TOOL_CALL' 
  | 'AGENT_STEP' 
  | 'WEBHOOK_AI' 
  | 'BACKGROUND_JOB'

export interface ExecutionContext {
  systemId: string
  operationType: OperationType
  endpoint?: string
  actorApiKeyId?: string
  requestId?: string
  repoOrProject?: string
  metadata?: Record<string, unknown>
}

export class KillSwitchTriggeredError extends Error {
  public readonly systemId: string
  public readonly killedAt: Date | null
  public readonly killReason: string | null
  public readonly eventId: string | null

  constructor(
    systemId: string,
    killedAt: Date | null,
    killReason: string | null,
    eventId: string | null
  ) {
    super(`AI execution blocked: Kill switch triggered for system ${systemId}. Reason: ${killReason || 'No reason provided'}`)
    this.name = 'KillSwitchTriggeredError'
    this.systemId = systemId
    this.killedAt = killedAt
    this.killReason = killReason
    this.eventId = eventId
  }
}

/**
 * Central enforcement guard - call this before any AI execution
 * 
 * @throws KillSwitchTriggeredError if execution is blocked
 */
export async function assertAiExecutionAllowed(context: ExecutionContext): Promise<void> {
  const { systemId, operationType, endpoint, actorApiKeyId, requestId, repoOrProject } = context

  // Check cache first
  const cached = stateCache.get(systemId)
  const now = Date.now()
  
  let executionState: ExecutionState
  let killedAt: Date | null = null
  let killReason: string | null = null
  let lastStateChangeEventId: string | null = null

  if (cached && (now - cached.cachedAt) < CACHE_TTL_MS) {
    executionState = cached.state
  } else {
    // Fetch from database
    const system = await prisma.kill_switch_systems.findUnique({
      where: { id: systemId },
      select: {
        executionState: true,
        killedAt: true,
        killReason: true,
        lastStateChangeEventId: true
      }
    })

    if (!system) {
      // FAIL CLOSED: System not found - block execution by default
      console.error(`[KillSwitch] Unknown system blocked: ${systemId}`)
      throw new KillSwitchTriggeredError(
        systemId,
        null,
        `System '${systemId}' not registered. Register at https://www.haiec.com/kill-switch/systems/new`,
        null
      )
    }

    executionState = system.executionState as ExecutionState
    killedAt = system.killedAt
    killReason = system.killReason
    lastStateChangeEventId = system.lastStateChangeEventId

    // Update cache with version from database
    // Version increments on every state change to detect stale reads
    const version = system.lastStateChangeEventId ? 
      parseInt(system.lastStateChangeEventId.slice(-8), 16) : 0
    stateCache.set(systemId, { state: executionState, cachedAt: now, version })
  }

  // If OPEN, allow execution
  if (executionState === 'OPEN') {
    return
  }

  // KILLED - block execution and record evidence
  await recordBlockedAttempt(systemId, context, lastStateChangeEventId)

  throw new KillSwitchTriggeredError(systemId, killedAt, killReason, lastStateChangeEventId)
}

/**
 * Record a blocked attempt (rate-limited to prevent log spam)
 * Also captures time-to-effect evidence on first block after trigger
 */
async function recordBlockedAttempt(
  systemId: string,
  context: ExecutionContext,
  eventId: string | null
): Promise<void> {
  const now = Date.now()
  const key = systemId

  // Rate limiting check
  const lastLog = blockedAttemptLog.get(key)
  if (lastLog && (now - lastLog.lastLogged) < LOG_RATE_LIMIT_MS) {
    // Just increment count, don't log
    lastLog.count++
    return
  }

  // Log the blocked attempt
  const count = lastLog?.count || 0
  blockedAttemptLog.set(key, { count: 1, lastLogged: now })

  try {
    // Create blocked attempt event
    await prisma.kill_switch_events.create({
      data: {
        systemId,
        triggeredBy: 'guard',
        triggeredByUser: context.actorApiKeyId,
        reason: `Blocked ${context.operationType} at ${context.endpoint || 'unknown endpoint'}`,
        layersActivated: [3],
        eventType: 'BLOCKED_ATTEMPT',
        scope: 'AI_EXECUTION',
        requestId: context.requestId,
        metrics: count > 0 ? JSON.stringify({ suppressedCount: count }) : undefined
      }
    })

    // Check if this is the first blocked attempt after trigger (for time-to-effect)
    if (eventId) {
      const triggerEvent = await prisma.kill_switch_events.findUnique({
        where: { id: eventId },
        select: { effectiveAt: true, triggeredAt: true }
      })

      if (triggerEvent && !triggerEvent.effectiveAt) {
        // First blocked attempt - capture time-to-effect
        const effectiveAt = new Date()
        const timeToEffectMs = effectiveAt.getTime() - triggerEvent.triggeredAt.getTime()

        await prisma.kill_switch_events.update({
          where: { id: eventId },
          data: {
            effectiveAt,
            timeToEffectMs
          }
        })
      }
    }
  } catch (error) {
    // Log error but don't fail the block
    console.error('Failed to record blocked attempt:', error)
  }
}

/**
 * Invalidate cache for a system (call after state change)
 */
export function invalidateExecutionStateCache(systemId: string): void {
  stateCache.delete(systemId)
}

/**
 * Clear all caches (for testing)
 */
export function clearAllCaches(): void {
  stateCache.clear()
  blockedAttemptLog.clear()
}

/**
 * Wrapper for LLM calls that enforces kill switch
 */
export async function withKillSwitchGuard<T>(
  context: ExecutionContext,
  fn: () => Promise<T>
): Promise<T> {
  await assertAiExecutionAllowed(context)
  return fn()
}

/**
 * Check if a system is currently killed (non-throwing version)
 */
export async function isSystemKilled(systemId: string): Promise<boolean> {
  try {
    await assertAiExecutionAllowed({
      systemId,
      operationType: 'LLM_CALL'
    })
    return false
  } catch (error) {
    if (error instanceof KillSwitchTriggeredError) {
      return true
    }
    throw error
  }
}

/**
 * Separation of duties check:
 * "Kill switch cannot be triggered by the same API key used by the AI runtime."
 * 
 * SOC2 CC6.2 Requirement: Separation of duties between runtime and admin functions
 * EU AI Act Article 14: Human oversight must be independent from automated systems
 */
export async function validateSeparationOfDuties(
  triggerApiKeyId: string,
  systemId: string
): Promise<{ valid: boolean; error?: string }> {
  // Verify system exists
  const system = await prisma.kill_switch_systems.findUnique({
    where: { id: systemId },
    select: { organizationId: true }
  })

  if (!system) {
    return { valid: false, error: 'System not found' }
  }

  // Get the triggering API key details
  const triggerKey = await prisma.api_keys.findUnique({
    where: { id: triggerApiKeyId },
    select: { 
      keyType: true, 
      systemId: true,
      role: true,
      organizationId: true
    }
  })

  if (!triggerKey) {
    return { valid: false, error: 'API key not found' }
  }

  // RULE 1: Runtime keys cannot trigger kill switch (SOD violation)
  if (triggerKey.keyType === 'runtime') {
    return { 
      valid: false, 
      error: 'Runtime API keys cannot trigger kill switch. Use an admin key for human oversight.' 
    }
  }

  // RULE 2: Admin keys must be 'admin' role
  if (triggerKey.keyType === 'admin' && triggerKey.role !== 'admin') {
    return {
      valid: false,
      error: 'Only admin role keys can trigger kill switch'
    }
  }

  // RULE 3: Admin keys can only trigger their assigned system (unless global admin)
  if (triggerKey.systemId && triggerKey.systemId !== systemId) {
    return {
      valid: false,
      error: `This admin key is only authorized for system ${triggerKey.systemId}`
    }
  }

  // RULE 4: Cross-organization triggers not allowed
  if (triggerKey.organizationId !== system.organizationId) {
    return {
      valid: false,
      error: 'Cannot trigger kill switch for systems in different organizations'
    }
  }

  // All checks passed
  return { valid: true }
}
