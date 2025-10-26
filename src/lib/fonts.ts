import { Inter, Poppins, Playfair_Display, Comfortaa, Urbanist, Roboto_Flex} from 'next/font/google'

export const bodyFont = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' })
export const headingFont = Poppins({ subsets: ['latin'], weight: ['600','700','900'], variable: '--font-heading', display: 'swap' })
export const uiFont = Playfair_Display({ subsets: ['latin'], variable: '--font-ui', display: 'swap' })
export const comfortaaFont = Comfortaa({ subsets: ['latin'], variable: '--font-comfortaa', weight: ['300','400','500','600','700'], display: 'swap' })
export const urbanistFont = Urbanist({ subsets: ['latin'], variable: '--font-urbanist', weight: ['400','500','600','700','800','900'], display: 'swap' })

// Roboto Flex as alternative to Acumin Variable Concept
export const acuminAlt = Roboto_Flex({ subsets: ['latin'], variable: '--font-acumin', display: 'swap' })


