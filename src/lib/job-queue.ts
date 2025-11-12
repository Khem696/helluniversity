/**
 * Job Queue System
 * 
 * Provides background job processing for async tasks
 * Supports retries, priorities, and scheduled execution
 */

import { getTursoClient } from './turso'
import { randomUUID } from 'crypto'

export interface Job {
  id: string
  type: string
  payload: string // JSON string
  priority: number // Higher = more priority
  maxRetries: number
  retryCount: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  scheduledAt: number
  createdAt: number
  updatedAt: number
  errorMessage?: string
  completedAt?: number
}

export type JobHandler = (payload: any) => Promise<void>

/**
 * Register job handlers
 */
const jobHandlers = new Map<string, JobHandler>()

/**
 * Register a job handler
 */
export function registerJobHandler(type: string, handler: JobHandler): void {
  jobHandlers.set(type, handler)
}

/**
 * Enqueue a job
 */
export async function enqueueJob(
  type: string,
  payload: any,
  options?: {
    priority?: number
    scheduledAt?: number
    maxRetries?: number
  }
): Promise<string> {
  const db = getTursoClient()
  const jobId = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  
  await db.execute({
    sql: `INSERT INTO job_queue (
      id, type, payload, priority, max_retries, retry_count, status,
      scheduled_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?)`,
    args: [
      jobId,
      type,
      JSON.stringify(payload),
      options?.priority || 0,
      options?.maxRetries || 3,
      options?.scheduledAt || now,
      now,
      now,
    ],
  })
  
  return jobId
}

/**
 * Get pending jobs ready for processing
 */
export async function getPendingJobs(limit: number = 10): Promise<Job[]> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  
  const result = await db.execute({
    sql: `SELECT * FROM job_queue
          WHERE status = 'pending' 
            AND scheduled_at <= ?
            AND retry_count < max_retries
          ORDER BY priority DESC, created_at ASC
          LIMIT ?`,
    args: [now, limit],
  })
  
  return result.rows.map((row: any) => ({
    id: row.id,
    type: row.type,
    payload: row.payload,
    priority: row.priority,
    maxRetries: row.max_retries,
    retryCount: row.retry_count,
    status: row.status,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    errorMessage: row.error_message || undefined,
    completedAt: row.completed_at || undefined,
  }))
}

/**
 * Mark job as processing
 */
async function markJobProcessing(id: string): Promise<void> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  
  await db.execute({
    sql: `UPDATE job_queue 
          SET status = 'processing', updated_at = ?
          WHERE id = ?`,
    args: [now, id],
  })
}

/**
 * Mark job as completed
 */
async function markJobCompleted(id: string): Promise<void> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  
  await db.execute({
    sql: `UPDATE job_queue 
          SET status = 'completed', completed_at = ?, updated_at = ?
          WHERE id = ?`,
    args: [now, now, id],
  })
}

/**
 * Mark job as failed and schedule retry
 */
async function markJobFailed(id: string, errorMessage: string, retryCount: number, maxRetries: number): Promise<void> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  
  // Exponential backoff: 1min, 5min, 15min, 30min, 1hr
  const retryDelays = [60, 300, 900, 1800, 3600] // seconds
  const delayIndex = Math.min(retryCount, retryDelays.length - 1)
  const delay = retryDelays[delayIndex]
  const nextScheduledAt = now + delay
  
  const status = retryCount >= maxRetries ? 'failed' : 'pending'
  
  await db.execute({
    sql: `UPDATE job_queue 
          SET status = ?, retry_count = ?, error_message = ?, scheduled_at = ?, updated_at = ?
          WHERE id = ?`,
    args: [status, retryCount + 1, errorMessage, nextScheduledAt, now, id],
  })
}

/**
 * Process a single job
 */
async function processJob(job: Job): Promise<void> {
  const handler = jobHandlers.get(job.type)
  
  if (!handler) {
    throw new Error(`No handler registered for job type: ${job.type}`)
  }
  
  try {
    await markJobProcessing(job.id)
    
    const payload = JSON.parse(job.payload)
    await handler(payload)
    
    await markJobCompleted(job.id)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await markJobFailed(job.id, errorMessage, job.retryCount, job.maxRetries)
    throw error
  }
}

/**
 * Process pending jobs
 */
export async function processJobQueue(limit: number = 10): Promise<{
  processed: number
  completed: number
  failed: number
  errors: string[]
}> {
  const jobs = await getPendingJobs(limit)
  const results = {
    processed: 0,
    completed: 0,
    failed: 0,
    errors: [] as string[],
  }
  
  for (const job of jobs) {
    try {
      results.processed++
      await processJob(job)
      results.completed++
    } catch (error) {
      results.failed++
      const errorMessage = error instanceof Error ? error.message : String(error)
      results.errors.push(`Job ${job.id} (${job.type}): ${errorMessage}`)
    }
  }
  
  return results
}

/**
 * Get job status
 */
export async function getJobStatus(id: string): Promise<Job | null> {
  const db = getTursoClient()
  
  const result = await db.execute({
    sql: `SELECT * FROM job_queue WHERE id = ?`,
    args: [id],
  })
  
  if (result.rows.length === 0) {
    return null
  }
  
  const row = result.rows[0] as any
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    priority: row.priority,
    maxRetries: row.max_retries,
    retryCount: row.retry_count,
    status: row.status,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    errorMessage: row.error_message || undefined,
    completedAt: row.completed_at || undefined,
  }
}

/**
 * Cancel a job
 */
export async function cancelJob(id: string): Promise<void> {
  const db = getTursoClient()
  const now = Math.floor(Date.now() / 1000)
  
  await db.execute({
    sql: `UPDATE job_queue 
          SET status = 'failed', error_message = 'Cancelled', updated_at = ?
          WHERE id = ? AND status IN ('pending', 'processing')`,
    args: [now, id],
  })
}

