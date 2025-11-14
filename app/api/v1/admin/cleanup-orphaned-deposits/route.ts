/**
 * Admin Cleanup Orphaned Deposit Blobs API v1
 *
 * Versioned endpoint for batch cleanup of orphaned deposit blobs
 * Maintains backward compatibility with /api/admin/cleanup-orphaned-deposits
 *
 * POST /api/v1/admin/cleanup-orphaned-deposits - Cleanup orphaned deposit blobs
 */

export { POST } from '../../../admin/cleanup-orphaned-deposits/route'

