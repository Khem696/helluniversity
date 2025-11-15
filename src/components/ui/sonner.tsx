"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-right"
      closeButton
      // Prevent overlapping: limit visible toasts and add gap between them
      visibleToasts={4}
      gap={12}
      expand={false}
      richColors
      // Prevent duplicate toasts from stacking
      toastOptions={{
        style: {
          maxWidth: "calc(100vw - 2rem)",
          width: "auto",
          minWidth: "280px",
        },
        className: "sm:max-w-md",
        classNames: {
          // Use theme-aware text colors that adapt to light/dark mode
          title: "font-medium text-foreground",
          description: "text-sm text-foreground/90",
          closeButton: "bg-red-600 hover:bg-red-700 text-white rounded-full opacity-100 border-0",
        },
        // Default duration for toasts (can be overridden per toast)
        // Shorter duration for info toasts, longer for success/error
        duration: 4000,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
