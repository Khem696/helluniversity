"use client"

import { useState } from "react"
import { API_PATHS } from "@/lib/api-config"
import { Button } from "@/components/ui/button"
import { Loader2, Database, CheckCircle2, XCircle, AlertCircle } from "lucide-react"

export function InitDatabaseButton() {
  const [isInitializing, setIsInitializing] = useState(false)
  const [status, setStatus] = useState<{
    type: "idle" | "success" | "error" | "checking"
    message?: string
    tables?: Record<string, boolean>
    missingTables?: string[]
    checkConstraintValid?: boolean
    checkConstraintMessage?: string
  }>({ type: "idle" })

  const checkStatus = async () => {
    setStatus({ type: "checking" })
    try {
      const response = await fetch("/api/v1/admin/init-db")
      
      // Check if response is ok
      if (!response.ok) {
        // If unauthorized, redirect to login
        if (response.status === 401 || response.status === 403) {
          setStatus({
            type: "error",
            message: "Authentication required. Please log in again.",
          })
          // Redirect to login after a short delay
          setTimeout(() => {
            window.location.href = "/admin/login"
          }, 2000)
          return
        }
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const responseData = await response.json()
      
      if (responseData.success && responseData.data) {
        const dbData = responseData.data
        const allValid = dbData.allTablesExist && dbData.checkConstraintValid !== false
        
        let statusMessage = ""
        if (!dbData.allTablesExist) {
          statusMessage = `${dbData.missingTables?.length || 0} tables missing`
        } else if (dbData.checkConstraintValid === false) {
          statusMessage = dbData.checkConstraintMessage || "CHECK constraint needs migration"
        } else {
          statusMessage = "All tables exist and CHECK constraint is valid"
        }
        
        setStatus({
          type: allValid ? "success" : "idle",
          message: statusMessage,
          tables: dbData.tables || {},
          missingTables: dbData.missingTables || [],
          checkConstraintValid: dbData.checkConstraintValid,
          checkConstraintMessage: dbData.checkConstraintMessage,
        })
      } else {
        const errorMessage = responseData.error?.message || responseData.error || "Failed to check status"
        setStatus({ type: "error", message: errorMessage })
      }
    } catch (error) {
      // Handle network errors and authentication errors
      const errorMessage = error instanceof Error ? error.message : "Failed to check database status"
      
      // Check if it's an authentication error
      if (errorMessage.includes("auth") || errorMessage.includes("session") || errorMessage.includes("Unauthorized")) {
        setStatus({
          type: "error",
          message: "Authentication error. Please refresh the page and log in again.",
        })
        setTimeout(() => {
          window.location.href = "/admin/login"
        }, 2000)
      } else {
        setStatus({ 
          type: "error", 
          message: errorMessage
        })
      }
    }
  }

  const initializeDatabase = async () => {
    setIsInitializing(true)
    setStatus({ type: "idle" })
    
    try {
      const response = await fetch(API_PATHS.adminInitDb, {
        method: "POST",
      })
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const responseData = await response.json()
      
      if (responseData.success && responseData.data) {
        const initData = responseData.data
        setStatus({ 
          type: "success", 
          message: initData.message || "Database initialized successfully" 
        })
        // Check status again to show updated table status
        setTimeout(() => checkStatus(), 1000)
      } else {
        const errorMessage = responseData.error?.message || responseData.error || "Failed to initialize database"
        setStatus({ 
          type: "error", 
          message: errorMessage
        })
      }
    } catch (error) {
      setStatus({ 
        type: "error", 
        message: error instanceof Error ? error.message : "Failed to initialize database" 
      })
    } finally {
      setIsInitializing(false)
    }
  }

  return (
    <div className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow">
      <div className="flex items-center gap-4 mb-4">
        <div className="flex-shrink-0 w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
          <Database className="w-6 h-6 text-purple-600" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900">Database</h3>
          <p className="text-sm text-gray-600">Initialize database schema</p>
        </div>
      </div>

      {/* Status Display */}
      {status.type !== "idle" && (
        <div className={`mb-4 p-3 rounded-lg ${
          status.type === "success" 
            ? "bg-green-50 border border-green-200" 
            : status.type === "error"
            ? "bg-red-50 border border-red-200"
            : "bg-blue-50 border border-blue-200"
        }`}>
          <div className="flex items-start gap-2">
            {status.type === "success" && <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />}
            {status.type === "error" && <XCircle className="w-5 h-5 text-red-600 mt-0.5" />}
            {status.type === "checking" && <Loader2 className="w-5 h-5 text-blue-600 mt-0.5 animate-spin" />}
            <div className="flex-1">
              <p className={`text-sm font-medium ${
                status.type === "success" 
                  ? "text-green-800" 
                  : status.type === "error"
                  ? "text-red-800"
                  : "text-blue-800"
              }`}>
                {status.message}
              </p>
              {status.missingTables && status.missingTables.length > 0 && (
                <p className="text-xs text-gray-600 mt-1">
                  Missing: {status.missingTables.join(", ")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Table Status */}
      {status.tables && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <p className="text-xs font-semibold text-gray-700 mb-2">Table Status:</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(status.tables).map(([table, exists]) => (
              <div key={table} className="flex items-center gap-2">
                {exists ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-600" />
                )}
                <span className="text-xs text-gray-600">{table}</span>
              </div>
            ))}
          </div>
          
          {/* CHECK Constraint Status */}
          {status.checkConstraintValid !== undefined && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="flex items-center gap-2">
                {status.checkConstraintValid ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-600" />
                )}
                <span className="text-xs font-semibold text-gray-700">CHECK Constraint:</span>
                <span className={`text-xs ${
                  status.checkConstraintValid ? "text-green-700" : "text-red-700"
                }`}>
                  {status.checkConstraintMessage || (status.checkConstraintValid ? "Valid" : "Needs Migration")}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button
          onClick={checkStatus}
          variant="outline"
          size="sm"
          disabled={isInitializing || status.type === "checking"}
          className="flex-1"
        >
          {status.type === "checking" ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Checking...
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4 mr-2" />
              Check Status
            </>
          )}
        </Button>
        <Button
          onClick={initializeDatabase}
          disabled={isInitializing || status.type === "checking"}
          size="sm"
          className="flex-1 bg-purple-600 hover:bg-purple-700"
        >
          {isInitializing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Initializing...
            </>
          ) : (
            <>
              <Database className="w-4 h-4 mr-2" />
              Initialize
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

