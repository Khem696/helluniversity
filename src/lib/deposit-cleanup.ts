/**
 * Deposit Blob Cleanup Utilities
 * 
 * Shared functions for cleaning up orphaned deposit blobs
 */

import { getTursoClient } from "./turso"
import { listImages, deleteImage } from "./blob"
import { createRequestLogger } from "./logger"

export interface CleanupOrphanedDepositsResult {
  checked: number
  orphaned: number
  deleted: number
  errors: string[]
}

/**
 * Cleanup orphaned deposit blobs
 * 
 * Finds and deletes deposit evidence blobs that are not referenced in the bookings table
 * 
 * @param logger - Optional logger instance (will create one if not provided)
 * @returns Cleanup statistics
 */
export async function cleanupOrphanedDepositBlobs(
  logger?: Awaited<ReturnType<typeof createRequestLogger>>
): Promise<CleanupOrphanedDepositsResult> {
  const requestId = crypto.randomUUID()
  const cleanupLogger = logger || createRequestLogger(requestId, 'cleanup-orphaned-deposits')
  
  const results: CleanupOrphanedDepositsResult = {
    checked: 0,
    orphaned: 0,
    deleted: 0,
    errors: [],
  }

  try {
    // Step 1: Get all deposit_evidence_url values from database
    await cleanupLogger.info('Fetching all deposit evidence URLs from database')
    const db = getTursoClient()
    const bookingsResult = await db.execute({
      sql: `SELECT DISTINCT deposit_evidence_url FROM bookings WHERE deposit_evidence_url IS NOT NULL AND deposit_evidence_url != ''`,
    })

    const referencedUrls = new Set<string>()
    for (const row of bookingsResult.rows) {
      const url = (row as any).deposit_evidence_url
      if (url && typeof url === 'string') {
        referencedUrls.add(url)
      }
    }

    await cleanupLogger.info(`Found ${referencedUrls.size} deposit evidence URLs in database`)

    // Step 2: List all blobs with "deposit-" prefix from Blob Storage
    await cleanupLogger.info('Listing deposit blobs from Blob Storage')
    const allDepositBlobs: string[] = []
    let cursor: string | undefined = undefined
    let hasMore = true
    const BATCH_SIZE = 1000 // Vercel Blob list limit

    while (hasMore) {
      try {
        const listResult = await listImages({
          prefix: 'deposit-',
          limit: BATCH_SIZE,
          cursor,
        })

        // Extract blob URLs from the result
        // Vercel Blob list() returns an array of blob objects or an object with blobs array
        // Handle both cases for compatibility
        let blobs: any[] = []
        if (Array.isArray(listResult)) {
          blobs = listResult
        } else if (listResult && typeof listResult === 'object') {
          // Check for common response structures
          if ('blobs' in listResult && Array.isArray((listResult as any).blobs)) {
            blobs = (listResult as any).blobs
          } else if ('data' in listResult && Array.isArray((listResult as any).data)) {
            blobs = (listResult as any).data
          } else {
            // Try to extract array from object values
            const values = Object.values(listResult)
            if (values.length > 0 && Array.isArray(values[0])) {
              blobs = values[0]
            }
          }
        }

        for (const blob of blobs) {
          // Handle different blob object structures
          const url = blob?.url || blob?.downloadUrl || blob?.href || (typeof blob === 'string' ? blob : null)
          if (url && typeof url === 'string') {
            allDepositBlobs.push(url)
          }
        }

        results.checked += blobs.length
        
        // Extract cursor and hasMore from response
        if (listResult && typeof listResult === 'object' && !Array.isArray(listResult)) {
          cursor = (listResult as any).cursor || (listResult as any).nextCursor || undefined
          // Check if there are more results
          // Vercel Blob typically returns hasMore boolean or we check if cursor exists
          const responseHasMore = (listResult as any).hasMore
          if (typeof responseHasMore === 'boolean') {
            hasMore = responseHasMore
          } else if (cursor) {
            // If cursor exists, assume there might be more (unless we got 0 blobs)
            hasMore = blobs.length > 0
          } else {
            hasMore = false // No cursor and no hasMore flag means we're done
          }
        } else {
          hasMore = false // If it's an array, assume no pagination
        }
        
        // Safety check: if we got 0 blobs and no cursor, we're done
        if (blobs.length === 0 && !cursor) {
          hasMore = false
        }

        await cleanupLogger.debug(`Fetched batch of ${blobs.length} deposit blobs, total so far: ${allDepositBlobs.length}`)
      } catch (listError) {
        await cleanupLogger.error('Failed to list deposit blobs', listError instanceof Error ? listError : new Error(String(listError)))
        results.errors.push(`Failed to list blobs: ${listError instanceof Error ? listError.message : 'Unknown error'}`)
        hasMore = false // Stop on error
      }
    }

    await cleanupLogger.info(`Found ${allDepositBlobs.length} deposit blobs in Blob Storage`)

    // Step 3: Find orphaned blobs (blobs not in database)
    const orphanedBlobs: string[] = []
    for (const blobUrl of allDepositBlobs) {
      if (!referencedUrls.has(blobUrl)) {
        orphanedBlobs.push(blobUrl)
      }
    }

    results.orphaned = orphanedBlobs.length

    await cleanupLogger.info(`Found ${orphanedBlobs.length} orphaned deposit blobs`)

    // Step 4: Delete orphaned blobs in batches
    if (orphanedBlobs.length > 0) {
      await cleanupLogger.info(`Starting deletion of ${orphanedBlobs.length} orphaned deposit blobs`)
      
      const DELETE_BATCH_SIZE = 10 // Delete in small batches to avoid rate limits
      for (let i = 0; i < orphanedBlobs.length; i += DELETE_BATCH_SIZE) {
        const batch = orphanedBlobs.slice(i, i + DELETE_BATCH_SIZE)
        
        await Promise.allSettled(
          batch.map(async (blobUrl) => {
            try {
              await deleteImage(blobUrl)
              results.deleted++
              await cleanupLogger.debug(`Deleted orphaned deposit blob: ${blobUrl.substring(0, 50)}...`)
            } catch (deleteError) {
              const errorMsg = `Failed to delete ${blobUrl.substring(0, 50)}...: ${deleteError instanceof Error ? deleteError.message : 'Unknown error'}`
              results.errors.push(errorMsg)
              await cleanupLogger.error('Failed to delete orphaned deposit blob', deleteError instanceof Error ? deleteError : new Error(String(deleteError)), { blobUrl })
            }
          })
        )

        // Small delay between batches to avoid rate limits
        if (i + DELETE_BATCH_SIZE < orphanedBlobs.length) {
          await new Promise(resolve => setTimeout(resolve, 100)) // 100ms delay
        }
      }

      await cleanupLogger.info(`Deleted ${results.deleted} orphaned deposit blobs`)
    } else {
      await cleanupLogger.info('No orphaned deposit blobs found')
    }

  } catch (error) {
    await cleanupLogger.error('Error during orphaned deposit blob cleanup', error instanceof Error ? error : new Error(String(error)))
    results.errors.push(`Cleanup process error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  await cleanupLogger.info('Cleanup orphaned deposit blobs completed', {
    checked: results.checked,
    orphaned: results.orphaned,
    deleted: results.deleted,
    errorsCount: results.errors.length
  })

  return results
}

