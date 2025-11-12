"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      closeButton
      // Responsive settings for smaller screens
      toastOptions={{
        style: {
          maxWidth: "calc(100vw - 2rem)",
          width: "auto",
          minWidth: "280px",
          color: "#000000",
        },
        className: "sm:max-w-md",
        classNames: {
          title: "text-black",
          description: "text-black",
          closeButton: "bg-red-600 hover:bg-red-700 text-white rounded-full opacity-100 border-0",
        },
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
