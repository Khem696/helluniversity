"use client"

import { useState, useEffect } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Clock } from "lucide-react"

interface TimePickerProps {
  value: string // 24-hour format: "HH:MM"
  onChange: (value: string) => void // Returns 24-hour format: "HH:MM"
  disabled?: boolean
  id?: string
  name?: string
  required?: boolean
  className?: string
}

// Get AM/PM from 24-hour format (for display only)
function getAMPM(time24: string): "AM" | "PM" {
  if (!time24 || !time24.includes(':')) {
    return "AM"
  }
  
  const [hours] = time24.split(':')
  const hour24 = parseInt(hours, 10)
  
  if (isNaN(hour24)) {
    return "AM"
  }
  
  return hour24 < 12 ? "AM" : "PM"
}

// Format 24-hour time with AM/PM for display (keeps 24-hour format)
// Converts "13:00" -> "13:00 PM", "09:30" -> "09:30 AM", "00:00" -> "00:00 AM"
function formatTimeDisplay(time24: string): string {
  if (!time24 || !time24.includes(':')) {
    return "00:00 AM"
  }
  
  const [hours, minutes] = time24.split(':')
  const hour24 = parseInt(hours, 10)
  const minute = parseInt(minutes || '00', 10)
  
  if (isNaN(hour24) || isNaN(minute)) {
    return "00:00 AM"
  }
  
  // Keep 24-hour format, just add AM/PM
  const period = hour24 < 12 ? 'AM' : 'PM'
  return `${hour24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ${period}`
}

export function TimePicker({ value, onChange, disabled, id, name, required, className }: TimePickerProps) {
  const [mounted, setMounted] = useState(false)
  
  // Parse 24-hour format
  const parseTime24 = (time24: string): { hour: number; minute: number } => {
    if (!time24 || !time24.includes(':')) {
      return { hour: 0, minute: 0 }
    }
    
    const [hours, minutes] = time24.split(':')
    const hour24 = parseInt(hours, 10)
    const minute = parseInt(minutes || '00', 10)
    
    if (isNaN(hour24) || isNaN(minute)) {
      return { hour: 0, minute: 0 }
    }
    
    return { hour: hour24, minute }
  }
  
  const { hour, minute } = parseTime24(value)
  const [selectedHour, setSelectedHour] = useState<number>(hour)
  const [selectedMinute, setSelectedMinute] = useState<number>(minute)
  const period = getAMPM(value) // Auto-determined, not selectable

  // Ensure component is mounted before rendering Select components to prevent hydration mismatches
  useEffect(() => {
    setMounted(true)
  }, [])

  // Update local state when value prop changes
  useEffect(() => {
    if (mounted) {
      const { hour: h, minute: m } = parseTime24(value)
      setSelectedHour(h)
      setSelectedMinute(m)
    }
  }, [value, mounted])

  // Generate hour options (0-23) for 24-hour format
  const hourOptions = Array.from({ length: 24 }, (_, i) => i)
  
  // Generate minute options (00-59)
  const minuteOptions = Array.from({ length: 60 }, (_, i) => i)

  // Generate label ID for ARIA association
  const labelId = id ? `${id}-label` : undefined

  const handleHourChange = (newHour: string) => {
    const h = parseInt(newHour, 10)
    setSelectedHour(h)
    const newTime24 = `${h.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`
    onChange(newTime24)
  }

  const handleMinuteChange = (newMinute: string) => {
    const m = parseInt(newMinute, 10)
    setSelectedMinute(m)
    const newTime24 = `${selectedHour.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
    onChange(newTime24)
  }

  // Render a placeholder during SSR to prevent hydration mismatches
  if (!mounted) {
    return (
      <div className={`relative ${className || ''}`}>
        <div 
          className={`flex items-center gap-1 border border-input bg-input-background rounded-md px-3 py-1 text-sm ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          style={{ height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
        >
          <div className="w-12 h-5 bg-gray-100 rounded animate-pulse" />
          <span className="text-gray-500 font-comfortaa" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}>:</span>
          <div className="w-12 h-5 bg-gray-100 rounded animate-pulse" />
          <div className="w-14 h-5 bg-gray-100 rounded animate-pulse ml-1" />
          <Clock className="ml-auto w-4 h-4 text-gray-400 pointer-events-none flex-shrink-0" />
        </div>
        <input
          type="hidden"
          id={id}
          name={name}
          value={value}
          required={required}
        />
      </div>
    )
  }

  return (
    <div className={`relative ${className || ''}`}>
      <div 
        className={`flex items-center gap-1 border border-input bg-input-background rounded-md px-3 py-1 text-sm ring-offset-background focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        style={{ height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
      >
        <Select
          value={selectedHour.toString()}
          onValueChange={handleHourChange}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-label={id ? `${id} hour` : "Hour"}
        >
          <SelectTrigger 
            className="h-auto border-0 p-0 focus:ring-0 w-12 font-comfortaa shadow-none" 
            style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}
            aria-label="Hour"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {hourOptions.map((h) => (
              <SelectItem key={h} value={h.toString()}>
                {h.toString().padStart(2, '0')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <span className="text-gray-500 font-comfortaa" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }} aria-hidden="true">:</span>
        
        <Select
          value={selectedMinute.toString()}
          onValueChange={handleMinuteChange}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-label={id ? `${id} minute` : "Minute"}
        >
          <SelectTrigger 
            className="h-auto border-0 p-0 focus:ring-0 w-12 font-comfortaa shadow-none" 
            style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}
            aria-label="Minute"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {minuteOptions.map((m) => (
              <SelectItem key={m} value={m.toString()}>
                {m.toString().padStart(2, '0')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        {/* Display AM/PM (read-only, auto-determined from 24-hour format) */}
        <div 
          className="w-14 font-comfortaa ml-1 text-gray-600 flex items-center justify-center"
          style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}
          aria-label={id ? `${id} period` : "AM/PM"}
        >
          {period}
        </div>
        
        <Clock className="ml-auto w-4 h-4 text-gray-400 pointer-events-none flex-shrink-0" />
      </div>
      <input
        type="hidden"
        id={id}
        name={name}
        value={value}
        required={required}
      />
    </div>
  )
}
