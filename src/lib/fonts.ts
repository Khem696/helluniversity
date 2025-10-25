import { Inter, Poppins, Playfair_Display } from 'next/font/google'

export const bodyFont = Inter({ subsets: ['latin'], variable: '--font-body' })
export const headingFont = Poppins({ subsets: ['latin'], weight: ['600','700','900'], variable: '--font-heading' })
export const uiFont = Playfair_Display({ subsets: ['latin'], variable: '--font-ui' })

