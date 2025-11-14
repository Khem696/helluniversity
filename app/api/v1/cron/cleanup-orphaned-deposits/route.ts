/**
 * Cleanup Orphaned Deposit Blobs Cron Job API v1
 *
 * Versioned endpoint for batch cleanup of orphaned deposit blobs
 * Maintains backward compatibility with /api/cron/cleanup-orphaned-deposits
 *
 * GET/POST /api/v1/cron/cleanup-orphaned-deposits - Cleanup orphaned deposit blobs
 */

export { GET, POST } from '../../../cron/cleanup-orphaned-deposits/route'

