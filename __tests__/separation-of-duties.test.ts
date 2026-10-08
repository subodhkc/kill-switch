/**
 * Tests for Separation of Duties Enforcement
 * Critical: Verifies SOC2 CC6.2 and EU AI Act Article 14 compliance
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { validateSeparationOfDuties } from '../execution-guard'

// In-memory stores for mock database
const mockSystems = new Map<string, any>()
const mockApiKeys = new Map<string, any>()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    kill_switch_systems: {
      findUnique: vi.fn(({ where: { id } }: { where: { id: string } }) => mockSystems.get(id) || null),
      create: vi.fn(({ data }: { data: any }) => { mockSystems.set(data.id, data); return data }),
      deleteMany: vi.fn(({ where }: { where: any }) => {
        if (where.id) mockSystems.delete(where.id)
        return { count: 1 }
      }),
    },
    api_keys: {
      findUnique: vi.fn(({ where: { id } }: { where: { id: string } }) => mockApiKeys.get(id) || null),
      create: vi.fn(({ data }: { data: any }) => { mockApiKeys.set(data.id, data); return data }),
      deleteMany: vi.fn(({ where }: { where: any }) => {
        if (where.organizationId) {
          for (const [id, key] of mockApiKeys.entries()) {
            if (key.organizationId === where.organizationId) mockApiKeys.delete(id)
          }
        }
        return { count: 0 }
      }),
    },
  },
}))

import { prisma } from '@/lib/prisma'

describe('validateSeparationOfDuties - SOC2 CC6.2 Compliance', () => {
  const testOrgId = 'test_org_' + Date.now()
  const testSystemId = 'test_system_' + Date.now()
  
  beforeEach(async () => {
    mockSystems.clear()
    mockApiKeys.clear()
    // Create test system
    await prisma.kill_switch_systems.create({
      data: {
        id: testSystemId,
        organizationId: testOrgId,
        name: 'Test System',
        executionState: 'OPEN',
        status: 'healthy',
        currentThrottle: 100,
        circuitBreakerState: 'closed',
        activeLayers: []
      }
    })
  })

  afterEach(async () => {
    // Cleanup
    await prisma.api_keys.deleteMany({
      where: { organizationId: testOrgId }
    })
    await prisma.kill_switch_systems.deleteMany({
      where: { id: testSystemId }
    })
    mockSystems.clear()
    mockApiKeys.clear()
  })

  describe('RULE 1: Runtime keys cannot trigger kill switch', () => {
    it('should BLOCK runtime keys from triggering kill switch', async () => {
      const runtimeKeyId = 'test_runtime_key_' + Date.now()
      
      await prisma.api_keys.create({
        data: {
          id: runtimeKeyId,
          organizationId: testOrgId,
          provider: 'openai',
          keyName: 'Runtime Key',
          encryptedKey: 'encrypted',
          keyHash: 'hash_' + Date.now(),
          role: 'viewer',
          keyType: 'runtime'
        }
      })

      const result = await validateSeparationOfDuties(runtimeKeyId, testSystemId)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Runtime API keys cannot trigger kill switch')
      expect(result.error).toContain('admin key')
    })
  })

  describe('RULE 2: Admin keys must have admin role', () => {
    it('should BLOCK admin keyType with non-admin role', async () => {
      const invalidAdminKeyId = 'test_invalid_admin_' + Date.now()
      
      await prisma.api_keys.create({
        data: {
          id: invalidAdminKeyId,
          organizationId: testOrgId,
          provider: 'openai',
          keyName: 'Invalid Admin Key',
          encryptedKey: 'encrypted',
          keyHash: 'hash_' + Date.now(),
          role: 'operator', // Not admin role
          keyType: 'admin' // But admin keyType
        }
      })

      const result = await validateSeparationOfDuties(invalidAdminKeyId, testSystemId)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Only admin role keys can trigger kill switch')
    })

    it('should ALLOW admin keyType with admin role', async () => {
      const validAdminKeyId = 'test_valid_admin_' + Date.now()
      
      await prisma.api_keys.create({
        data: {
          id: validAdminKeyId,
          organizationId: testOrgId,
          provider: 'openai',
          keyName: 'Valid Admin Key',
          encryptedKey: 'encrypted',
          keyHash: 'hash_' + Date.now(),
          role: 'admin',
          keyType: 'admin'
        }
      })

      const result = await validateSeparationOfDuties(validAdminKeyId, testSystemId)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })
  })

  describe('RULE 3: System-specific admin keys', () => {
    it('should BLOCK admin key from triggering different system', async () => {
      const otherSystemId = 'test_other_system_' + Date.now()
      const systemSpecificKeyId = 'test_system_specific_' + Date.now()
      
      await prisma.api_keys.create({
        data: {
          id: systemSpecificKeyId,
          organizationId: testOrgId,
          provider: 'openai',
          keyName: 'System-Specific Admin',
          encryptedKey: 'encrypted',
          keyHash: 'hash_' + Date.now(),
          role: 'admin',
          keyType: 'admin',
          systemId: otherSystemId // Assigned to different system
        }
      })

      const result = await validateSeparationOfDuties(systemSpecificKeyId, testSystemId)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('only authorized for system')
      expect(result.error).toContain(otherSystemId)
    })

    it('should ALLOW admin key to trigger assigned system', async () => {
      const systemSpecificKeyId = 'test_system_specific_' + Date.now()
      
      await prisma.api_keys.create({
        data: {
          id: systemSpecificKeyId,
          organizationId: testOrgId,
          provider: 'openai',
          keyName: 'System-Specific Admin',
          encryptedKey: 'encrypted',
          keyHash: 'hash_' + Date.now(),
          role: 'admin',
          keyType: 'admin',
          systemId: testSystemId // Assigned to this system
        }
      })

      const result = await validateSeparationOfDuties(systemSpecificKeyId, testSystemId)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should ALLOW global admin (systemId=null) to trigger any system', async () => {
      const globalAdminKeyId = 'test_global_admin_' + Date.now()
      
      await prisma.api_keys.create({
        data: {
          id: globalAdminKeyId,
          organizationId: testOrgId,
          provider: 'openai',
          keyName: 'Global Admin',
          encryptedKey: 'encrypted',
          keyHash: 'hash_' + Date.now(),
          role: 'admin',
          keyType: 'admin',
          systemId: null // Global admin
        }
      })

      const result = await validateSeparationOfDuties(globalAdminKeyId, testSystemId)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })
  })

  describe('RULE 4: Cross-organization protection', () => {
    it('should BLOCK admin key from different organization', async () => {
      const otherOrgId = 'test_other_org_' + Date.now()
      const crossOrgKeyId = 'test_cross_org_' + Date.now()
      
      await prisma.api_keys.create({
        data: {
          id: crossOrgKeyId,
          organizationId: otherOrgId, // Different org
          provider: 'openai',
          keyName: 'Cross-Org Admin',
          encryptedKey: 'encrypted',
          keyHash: 'hash_' + Date.now(),
          role: 'admin',
          keyType: 'admin'
        }
      })

      const result = await validateSeparationOfDuties(crossOrgKeyId, testSystemId)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('different organizations')
    })
  })

  describe('Error cases', () => {
    it('should return error for non-existent API key', async () => {
      const result = await validateSeparationOfDuties('non_existent_key', testSystemId)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('API key not found')
    })

    it('should return error for non-existent system', async () => {
      const adminKeyId = 'test_admin_' + Date.now()
      
      await prisma.api_keys.create({
        data: {
          id: adminKeyId,
          organizationId: testOrgId,
          provider: 'openai',
          keyName: 'Admin Key',
          encryptedKey: 'encrypted',
          keyHash: 'hash_' + Date.now(),
          role: 'admin',
          keyType: 'admin'
        }
      })

      const result = await validateSeparationOfDuties(adminKeyId, 'non_existent_system')

      expect(result.valid).toBe(false)
      expect(result.error).toBe('System not found')
    })
  })

  describe('Compliance verification', () => {
    it('enforces SOC2 CC6.2 - Separation of duties between runtime and admin', async () => {
      // This test verifies the core SOC2 requirement
      const runtimeKeyId = 'test_runtime_' + Date.now()
      
      await prisma.api_keys.create({
        data: {
          id: runtimeKeyId,
          organizationId: testOrgId,
          provider: 'openai',
          keyName: 'Runtime Key',
          encryptedKey: 'encrypted',
          keyHash: 'hash_' + Date.now(),
          role: 'viewer',
          keyType: 'runtime'
        }
      })

      const result = await validateSeparationOfDuties(runtimeKeyId, testSystemId)

      // SOC2 CC6.2: Runtime keys must not have admin privileges
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Runtime API keys cannot trigger kill switch')
    })

    it('enforces EU AI Act Article 14 - Human oversight independence', async () => {
      // This test verifies EU AI Act requirement for independent human oversight
      const adminKeyId = 'test_admin_' + Date.now()
      
      await prisma.api_keys.create({
        data: {
          id: adminKeyId,
          organizationId: testOrgId,
          provider: 'openai',
          keyName: 'Admin Key',
          encryptedKey: 'encrypted',
          keyHash: 'hash_' + Date.now(),
          role: 'admin',
          keyType: 'admin'
        }
      })

      const result = await validateSeparationOfDuties(adminKeyId, testSystemId)

      // EU AI Act Article 14: Admin keys (human oversight) can trigger kill switch
      expect(result.valid).toBe(true)
    })
  })
})
