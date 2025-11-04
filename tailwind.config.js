/** @type {import('tailwindcss').Config} */
/**
 * Tailwind CSS v4 - CSS-First Configuration
 * 
 * Most configuration is now in app/globals.css using @theme directive.
 * This file only contains content paths for file detection.
 * 
 * For full v4 migration, you can remove this file entirely if Tailwind
 * can auto-detect your content files, or keep it minimal like this.
 */
module.exports = {
  // Only content paths needed - all theme config moved to CSS
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  // darkMode can be handled via CSS or kept here for class-based dark mode
  darkMode: ["class"],
}
