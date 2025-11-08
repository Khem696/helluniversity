"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, addMonths, subMonths, startOfDay, isBefore } from "date-fns";
import { cn } from "./utils";
import { buttonVariants } from "./button";

interface SimpleCalendarProps {
  selected?: Date;
  onSelect?: (date: Date) => void;
  disabled?: (date: Date) => boolean;
  className?: string;
  month?: Date;
  onMonthChange?: (date: Date) => void;
}

export function SimpleCalendar({
  selected,
  onSelect,
  disabled,
  className,
  month: controlledMonth,
  onMonthChange,
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

            return (
              <div
                key={date.toISOString()}
                className={cn(
                  "relative aspect-square flex items-center justify-center p-0",
                  !isCurrentMonth && "text-muted-foreground opacity-50"
                )}
              >
                <button
                  type="button"
                  onClick={() => handleDateClick(date)}
                  disabled={isDisabled}
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "size-8 p-0 font-normal",
                    isSelected &&
                      "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                    isTodayDate && !isSelected &&
                      "bg-accent text-accent-foreground",
                    isDisabled && "opacity-50 cursor-not-allowed",
                    "focus:z-20"
                  )}
                >
                  {format(date, "d")}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

