/**
 * Tests for Kill Switch Execution Guard
 * Critical: Verifies fail-closed behavior for unknown systems
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { assertAiExecutionAllowed, KillSwitchTriggeredError, clearAllCaches } from '../execution-guard'

// In-memory store for mock database
const mockSystems = new Map<string, any>()
const mockEvents = new Map<string, any>()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    kill_switch_systems: {
      findUnique: vi.fn(({ where: { id } }: { where: { id: string } }) => mockSystems.get(id) || null),
      create: vi.fn(({ data }: { data: any }) => { mockSystems.set(data.id, data); return data }),
      deleteMany: vi.fn(({ where }: { where: any }) => {
        const deleted: string[] = []
        for (const id of mockSystems.keys()) {
          if (where.id?.startsWith && id.startsWith(where.id.startsWith)) deleted.push(id)
        }
        deleted.forEach(id => mockSystems.delete(id))
        return { count: deleted.length }
      }),
    },
    kill_switch_events: {
      create: vi.fn(({ data }: { data: any }) => { mockEvents.set(data.systemId + Date.now(), data); return data }),
      findUnique: vi.fn(({ where: { id } }: { where: { id: string } }) => mockEvents.get(id) || null),
      update: vi.fn(({ where: { id }, data }: { where: { id: string }, data: any }) => {
        const existing = mockEvents.get(id)
        if (existing) Object.assign(existing, data)
        return existing
      }),
    },
  },
}))

import { prisma } from '@/lib/prisma'

describe('assertAiExecutionAllowed - Fail-Closed Behavior', () => {
  beforeEach(async () => {
    clearAllCaches()
    mockSystems.clear()
    mockEvents.clear()
  })

  afterEach(async () => {
    // Cleanup test data
    await prisma.kill_switch_systems.deleteMany({
      where: { id: { startsWith: 'test_' } }
    })
    mockSystems.clear()
    mockEvents.clear()
  })

  it('should BLOCK unknown systems (fail-closed)', async () => {
    const unknownSystemId = 'test_unknown_system_' + Date.now()
    
    await expect(
      assertAiExecutionAllowed({
        systemId: unknownSystemId,
        operationType: 'LLM_CALL'
      })
    ).rejects.toThrow(KillSwitchTriggeredError)
  })

  it('should provide actionable error message for unknown systems', async () => {
    const unknownSystemId = 'test_unknown_system_' + Date.now()
    
    try {
      await assertAiExecutionAllowed({
        systemId: unknownSystemId,
        operationType: 'LLM_CALL'
      })
      expect(true).toBe(false) // Should have thrown error
    } catch (error) {
      expect(error).toBeInstanceOf(KillSwitchTriggeredError)
      expect((error as Error).message).toContain('not registered')
      expect((error as Error).message).toContain('https://www.haiec.com/kill-switch/systems/new')
    }
  })

  it('should ALLOW registered OPEN systems', async () => {
    const testSystemId = 'test_open_system_' + Date.now()
    
    // Create test system in OPEN state
    await prisma.kill_switch_systems.create({
      data: {
        id: testSystemId,
        organizationId: 'test_org',
        name: 'Test System',
        executionState: 'OPEN',
        status: 'healthy',
        currentThrottle: 100,
        circuitBreakerState: 'closed',
        activeLayers: []
      }
    })

    // Should not throw
    await expect(
      assertAiExecutionAllowed({
        systemId: testSystemId,
        operationType: 'LLM_CALL'
      })
    ).resolves.toBeUndefined()
  })

  it('should BLOCK registered KILLED systems', async () => {
    const testSystemId = 'test_killed_system_' + Date.now()
    
    // Create test system in KILLED state
    await prisma.kill_switch_systems.create({
      data: {
        id: testSystemId,
        organizationId: 'test_org',
        name: 'Test System',
        executionState: 'KILLED',
        status: 'killed',
        currentThrottle: 0,
        circuitBreakerState: 'open',
        activeLayers: [3],
        killedAt: new Date(),
        killReason: 'Test kill'
      }
    })

    await expect(
      assertAiExecutionAllowed({
        systemId: testSystemId,
        operationType: 'LLM_CALL'
      })
    ).rejects.toThrow(KillSwitchTriggeredError)
  })

  it('should log error when blocking unknown systems', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unknownSystemId = 'test_unknown_system_' + Date.now()
    
    try {
      await assertAiExecutionAllowed({
        systemId: unknownSystemId,
        operationType: 'LLM_CALL'
      })
    } catch (error) {
      // Expected
    }

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[KillSwitch] Unknown system blocked: ${unknownSystemId}`)
    )

    consoleSpy.mockRestore()
  })
})
