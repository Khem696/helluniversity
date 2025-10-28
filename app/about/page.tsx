import { Metadata } from 'next'
import { AboutPage as AboutContent } from '@/components/AboutPage'

export const metadata: Metadata = {
  title: 'About',
  description: 'Learn about Hell University – background, biography, and story.'
}

export default function About() {
  return (
    <div className="min-h-vp lg:h-[100dvh] bg-[#f4f1ed] overflow-x-hidden overflow-y-auto lg:overflow-hidden">
      <AboutContent />
    </div>
  )
}


