/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    screens: {
      xxs: "320px",       // smallest mobile (iPhone SE, many Android compacts)
      xs: "360px",        // small phones (Galaxy S8+)
      phone: "390px",     // modern iPhones (12/13/14)
      "phone-lg": "414px", // large phones (iPhone Plus / XR)
      "tablet-sm": "600px", // small tablets / large phones (Pixel Fold portrait)
      "tablet-md": "820px", // iPad Air/10th-gen portrait logical width
      "tablet-lg": "834px", // iPad Pro 11" portrait
      sm: "640px",        // Tailwind default small breakpoint
      md: "768px",        // tablets (iPad)
      lg: "1024px",       // large tablets / small laptops (iPad Pro)
      xl: "1280px",       // laptops
      desktop: "1440px",  // common desktop width
      "2xl": "1536px",   // Tailwind default 2xl
      "3xl": "1920px",   // full HD desktops
    },
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        body: ['var(--font-body)'],
        heading: ['var(--font-heading)'],
        ui: ['var(--font-ui)'],
        'helvetica': ['"Helvetica Neue"', '"Helvetica"', '"Arial"', 'sans-serif'],
        'inter': ['"Inter"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"Helvetica Neue"', '"Helvetica"', '"Arial"', 'sans-serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
