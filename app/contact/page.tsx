import { Metadata } from 'next'
import { ContactPage as ContactContent } from '@/components/ContactPage'

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Contact Hell University – get in touch for inquiries.'
}

export default function Contact() {
  return (
    <div className="min-h-screen bg-[#f4f1ed]">
      <ContactContent />
    </div>
  )
}


