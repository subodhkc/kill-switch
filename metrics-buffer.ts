/**
 * Persistent Metrics Buffer
 * 
 * Stores metrics in SQLite to prevent data loss on crash/restart.
 * Implements retry logic and overflow protection.
 */

import Database from 'better-sqlite3'
import { MetricReport } from './types'

export interface BufferedMetric {
  id: string
  systemId: string
  metrics: MetricReport
  retryCount: number
  createdAt: string
}

export class MetricsBuffer {
  private db: Database.Database
  private maxSize: number
  
  constructor(dbPath: string = '.kill-switch-buffer.db', maxSize: number = 10000) {
    this.db = new Database(dbPath)
    this.maxSize = maxSize
    this._createSchema()
  }
  
  private _createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metrics_buffer (
        id TEXT PRIMARY KEY,
        system_id TEXT NOT NULL,
        metrics TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_system_id ON metrics_buffer(system_id);
      CREATE INDEX IF NOT EXISTS idx_created_at ON metrics_buffer(created_at);
    `)
  }
  
  /**
   * Add a metric to the buffer.
   */
  add(systemId: string, metrics: MetricReport): string {
    // Check for overflow
    const count = this.getCount()
    if (count >= this.maxSize) {
      this._handleOverflow()
    }
    
    const id = this._generateId()
    const stmt = this.db.prepare(`
      INSERT INTO metrics_buffer (id, system_id, metrics, retry_count, created_at)
      VALUES (?, ?, ?, 0, ?)
    `)
    
    stmt.run(
      id,
      systemId,
      JSON.stringify(metrics),
      new Date().toISOString()
    )
    
    return id
  }
  
  /**
   * Get all buffered metrics.
   */
  getAll(): BufferedMetric[] {
    const stmt = this.db.prepare(`
      SELECT * FROM metrics_buffer ORDER BY created_at ASC
    `)
    
    const rows = stmt.all() as any[]
    return rows.map(row => ({
      id: row.id,
      systemId: row.system_id,
      metrics: JSON.parse(row.metrics),
      retryCount: row.retry_count,
      createdAt: row.created_at
    }))
  }
  
  /**
   * Get metrics for a specific system.
   */
  getBySystem(systemId: string): BufferedMetric[] {
    const stmt = this.db.prepare(`
      SELECT * FROM metrics_buffer 
      WHERE system_id = ?
      ORDER BY created_at ASC
    `)
    
    const rows = stmt.all(systemId) as any[]
    return rows.map(row => ({
      id: row.id,
      systemId: row.system_id,
      metrics: JSON.parse(row.metrics),
      retryCount: row.retry_count,
      createdAt: row.created_at
    }))
  }
  
  /**
   * Remove metrics by IDs.
   */
  remove(ids: string[]): void {
    if (ids.length === 0) return
    
    const placeholders = ids.map(() => '?').join(',')
    const stmt = this.db.prepare(`
      DELETE FROM metrics_buffer WHERE id IN (${placeholders})
    `)
    
    stmt.run(...ids)
  }
  
  /**
   * Increment retry count for a metric.
   */
  incrementRetry(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE metrics_buffer 
      SET retry_count = retry_count + 1 
      WHERE id = ?
    `)
    
    stmt.run(id)
  }
  
  /**
   * Get retry count for a metric.
   */
  getRetryCount(id: string): number {
    const stmt = this.db.prepare(`
      SELECT retry_count FROM metrics_buffer WHERE id = ?
    `)
    
    const row = stmt.get(id) as any
    return row ? row.retry_count : 0
  }
  
  /**
   * Get total count of buffered metrics.
   */
  getCount(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM metrics_buffer
    `)
    
    const row = stmt.get() as any
    return row.count
  }
  
  /**
   * Clear all metrics (for testing).
   */
  clear(): void {
    this.db.exec('DELETE FROM metrics_buffer')
  }
  
  /**
   * Close database connection.
   */
  close(): void {
    this.db.close()
  }
  
  /**
   * Handle buffer overflow by removing oldest metrics.
   */
  private _handleOverflow(): void {
    const removeCount = Math.floor(this.maxSize * 0.1) // Remove 10%
    
    const stmt = this.db.prepare(`
      DELETE FROM metrics_buffer 
      WHERE id IN (
        SELECT id FROM metrics_buffer 
        ORDER BY created_at ASC 
        LIMIT ?
      )
    `)
    
    stmt.run(removeCount)
    
    console.warn(`[MetricsBuffer] Overflow - removed ${removeCount} oldest metrics`)
  }
  
  /**
   * Generate unique ID for metric.
   */
  private _generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}
