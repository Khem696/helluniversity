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

// Convert 24-hour format to 12-hour format
function convert24To12(time24: string): { hour: number; minute: number; period: "AM" | "PM" } {
  if (!time24 || !time24.includes(':')) {
    return { hour: 12, minute: 0, period: "AM" }
  }
  
  const [hours, minutes] = time24.split(':')
  const hour24 = parseInt(hours, 10)
  const minute = parseInt(minutes || '00', 10)
  
  if (isNaN(hour24) || isNaN(minute)) {
    return { hour: 12, minute: 0, period: "AM" }
  }
  
  let hour12 = hour24 % 12
  if (hour12 === 0) hour12 = 12
  const period: "AM" | "PM" = hour24 < 12 ? "AM" : "PM"
  
  return { hour: hour12, minute, period }
}

// Convert 12-hour format to 24-hour format
function convert12To24(hour: number, minute: number, period: "AM" | "PM"): string {
  let hour24 = hour
  if (period === "PM" && hour !== 12) {
    hour24 = hour + 12
  } else if (period === "AM" && hour === 12) {
    hour24 = 0
  }
  
  return `${hour24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

export function TimePicker({ value, onChange, disabled, id, name, required, className }: TimePickerProps) {
  const [mounted, setMounted] = useState(false)
  const { hour, minute, period } = convert24To12(value)
  const [selectedHour, setSelectedHour] = useState<number>(hour)
  const [selectedMinute, setSelectedMinute] = useState<number>(minute)
  const [selectedPeriod, setSelectedPeriod] = useState<"AM" | "PM">(period)

  // Ensure component is mounted before rendering Select components to prevent hydration mismatches
  useEffect(() => {
    setMounted(true)
  }, [])

  // Update local state when value prop changes
  useEffect(() => {
    if (mounted) {
      const { hour: h, minute: m, period: p } = convert24To12(value)
      setSelectedHour(h)
      setSelectedMinute(m)
      setSelectedPeriod(p)
    }
  }, [value, mounted])

  // Generate hour options (1-12)
  const hourOptions = Array.from({ length: 12 }, (_, i) => i + 1)
  
  // Generate minute options (00-59)
  const minuteOptions = Array.from({ length: 60 }, (_, i) => i)

  // Generate label ID for ARIA association
  const labelId = id ? `${id}-label` : undefined

  const handleHourChange = (newHour: string) => {
    const h = parseInt(newHour, 10)
    setSelectedHour(h)
    onChange(convert12To24(h, selectedMinute, selectedPeriod))
  }

  const handleMinuteChange = (newMinute: string) => {
    const m = parseInt(newMinute, 10)
    setSelectedMinute(m)
    onChange(convert12To24(selectedHour, m, selectedPeriod))
  }

  const handlePeriodChange = (newPeriod: "AM" | "PM") => {
    setSelectedPeriod(newPeriod)
    onChange(convert12To24(selectedHour, selectedMinute, newPeriod))
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
        
        <Select
          value={selectedPeriod}
          onValueChange={handlePeriodChange}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-label={id ? `${id} period` : "AM/PM"}
        >
          <SelectTrigger 
            className="h-auto border-0 p-0 focus:ring-0 w-14 font-comfortaa ml-1 shadow-none" 
            style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}
            aria-label="AM/PM"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AM">AM</SelectItem>
            <SelectItem value="PM">PM</SelectItem>
          </SelectContent>
        </Select>
        
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

