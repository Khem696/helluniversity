"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, addMonths, subMonths, startOfDay, isBefore } from "date-fns";
import { cn } from "./utils";
import { buttonVariants } from "./button";
import { Tooltip, TooltipTrigger, TooltipContent } from "./tooltip";

interface OccupiedTimeRange {
  date: string; // ISO date string (YYYY-MM-DD)
  startTime: string | null;
  endTime: string | null;
  startDate: number; // Unix timestamp for full start
  endDate: number; // Unix timestamp for full end
}

interface SimpleCalendarProps {
  selected?: Date;
  onSelect?: (date: Date) => void;
  disabled?: (date: Date) => boolean;
  className?: string;
  month?: Date;
  onMonthChange?: (date: Date) => void;
  isOccupied?: (date: Date) => boolean; // Optional function to check if date is occupied (distinct from disabled)
  occupiedTimeRanges?: OccupiedTimeRange[]; // Optional time ranges for occupied dates (for tooltip)
}

export function SimpleCalendar({
  selected,
  onSelect,
  disabled,
  className,
  month: controlledMonth,
  onMonthChange,
  isOccupied,
  occupiedTimeRanges = [],
}: SimpleCalendarProps) {
  const [internalMonth, setInternalMonth] = React.useState(new Date());
  const month = controlledMonth || internalMonth;
  const setMonth = onMonthChange || setInternalMonth;

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  
  // Get first day of week for the month start (0 = Sunday, 6 = Saturday)
  const firstDayOfWeek = monthStart.getDay();
  
  // Get all days in the month
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  // Create calendar grid: 7 columns (days of week) x 6 rows (weeks)
  const calendarDays: (Date | null)[] = [];
  
  // Add empty cells for days before month starts
  for (let i = 0; i < firstDayOfWeek; i++) {
    calendarDays.push(null);
  }
  
  // Add all days in the month
  daysInMonth.forEach(day => {
    calendarDays.push(day);
  });
  
  // Fill remaining cells to complete 6 weeks (42 cells total)
  while (calendarDays.length < 42) {
    calendarDays.push(null);
  }

  const weekDays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const handlePreviousMonth = () => {
    setMonth(subMonths(month, 1));
  };

  const handleNextMonth = () => {
    setMonth(addMonths(month, 1));
  };

  const handleDateClick = (date: Date | null) => {
    if (date && onSelect && (!disabled || !disabled(date))) {
      onSelect(date);
    }
  };

  return (
    <div className={cn("p-3", className)}>
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={handlePreviousMonth}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "size-7 bg-transparent p-0 opacity-50 hover:opacity-100"
          )}
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="text-sm font-medium">
          {format(month, "MMMM yyyy")}
        </div>
        <button
          type="button"
          onClick={handleNextMonth}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "size-7 bg-transparent p-0 opacity-50 hover:opacity-100"
          )}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="w-full">
        {/* Day Headers */}
        <div className="grid grid-cols-7 gap-0 mb-2">
          {weekDays.map((day) => (
            <div
              key={day}
              className="text-muted-foreground text-center text-[0.8rem] font-normal py-1"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Days */}
        <div className="grid grid-cols-7 gap-0">
          {calendarDays.map((date, index) => {
            if (!date) {
              return <div key={index} className="aspect-square" />;
            }

            const isSelected = selected && isSameDay(date, selected);
            const isCurrentMonth = isSameMonth(date, month);
            const isTodayDate = isToday(date);
            const isDisabled = disabled ? disabled(date) : false;
            const isOccupiedDate = isOccupied ? isOccupied(date) : false;
            
            // Get time ranges for this date (for tooltip)
            const dateStr = format(date, "yyyy-MM-dd");
            const dateTimeRanges = occupiedTimeRanges.filter(
              (range) => range.date === dateStr
            );
            
            // Check if date is in the past (for tooltip)
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            const isPastDate = dateOnly < today;
            
            // Build tooltip text with specific messages for different disable reasons
            let tooltipText: string | undefined = undefined;
            if (isOccupiedDate && dateTimeRanges.length > 0) {
              // Occupied with time ranges
              const timeInfo = dateTimeRanges
                .map((range) => {
                  const start = range.startTime || "All day";
                  const end = range.endTime || "All day";
                  return start === end ? start : `${start} - ${end}`;
                })
                .join(", ");
              tooltipText = `This date is occupied: ${timeInfo}`;
            } else if (isOccupiedDate) {
              // Occupied without time ranges
              tooltipText = "This date is occupied";
            } else if (isDisabled) {
              // Determine specific reason for disabled date
              if (isPastDate) {
                tooltipText = "This date has passed";
              } else if (isTodayDate) {
                tooltipText = "Today cannot be selected";
              } else {
                tooltipText = "This date is unavailable";
              }
            }

            return (
              <div
                key={date.toISOString()}
                className={cn(
                  "relative aspect-square flex items-center justify-center p-0",
                  !isCurrentMonth && "text-muted-foreground opacity-50"
                )}
              >
                {tooltipText ? (
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <div className="w-full h-full flex items-center justify-center">
                        <button
                          type="button"
                          onClick={() => handleDateClick(date)}
                          disabled={isDisabled}
                          className={cn(
                            buttonVariants({ variant: "ghost" }),
                            "size-8 p-0 font-normal relative",
                            // Selected styling (but not if occupied - occupied takes priority)
                            isSelected && !isOccupiedDate &&
                              "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                            // Today styling (but not if selected or disabled)
                            isTodayDate && !isSelected && !isDisabled &&
                              "bg-accent text-accent-foreground",
                            // Styling for occupied dates (distinct from other disabled dates)
                            // Occupied dates always show red styling, even if selected
                            isOccupiedDate && 
                              "opacity-60 cursor-not-allowed bg-red-50 hover:bg-red-100 text-red-600",
                            // Selected AND occupied: show red background with primary border or different styling
                            isSelected && isOccupiedDate &&
                              "ring-2 ring-primary ring-offset-1",
                            // Styling for other disabled dates (past, today, etc.)
                            isDisabled && !isOccupiedDate &&
                              "opacity-40 cursor-not-allowed text-muted-foreground",
                            "focus:z-20"
                          )}
                        >
                          {format(date, "d")}
                          {/* Occupied date indicator - small dot in top-right corner */}
                          {isOccupiedDate && (
                            <span
                              className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full"
                              aria-label="Occupied"
                            />
                          )}
                        </button>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent 
                      side="top" 
                      sideOffset={8}
                      className="z-[100] bg-gray-900 text-white text-xs font-medium px-3 py-2 shadow-lg max-w-xs"
                    >
                      {tooltipText}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleDateClick(date)}
                    disabled={isDisabled}
                    className={cn(
                      buttonVariants({ variant: "ghost" }),
                      "size-8 p-0 font-normal relative",
                      // Selected styling (but not if occupied - occupied takes priority)
                      isSelected && !isOccupiedDate &&
                        "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                      // Today styling (but not if selected or disabled)
                      isTodayDate && !isSelected && !isDisabled &&
                        "bg-accent text-accent-foreground",
                      // Styling for occupied dates (distinct from other disabled dates)
                      // Occupied dates always show red styling, even if selected
                      isOccupiedDate && 
                        "opacity-60 cursor-not-allowed bg-red-50 hover:bg-red-100 text-red-600",
                      // Selected AND occupied: show red background with primary border or different styling
                      isSelected && isOccupiedDate &&
                        "ring-2 ring-primary ring-offset-1",
                      // Styling for other disabled dates (past, today, etc.)
                      isDisabled && !isOccupiedDate &&
                        "opacity-40 cursor-not-allowed text-muted-foreground",
                      "focus:z-20"
                    )}
                  >
                    {format(date, "d")}
                    {/* Occupied date indicator - small dot in top-right corner */}
                    {isOccupiedDate && (
                      <span
                        className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full"
                        aria-label="Occupied"
                      />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

