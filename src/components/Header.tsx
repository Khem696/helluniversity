"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { Calendar as CalendarIcon, Menu, X } from "lucide-react"
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { format } from "date-fns"
import { withBasePath } from "@/lib/utils"
import { Turnstile } from "./Turnstile"

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement | null>(null)
  const [bookingOpen, setBookingOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date>()
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [isTurnstileVerified, setIsTurnstileVerified] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    guests: "",
    eventType: "",
    introduction: "",
    biography: "",
    specialRequests: ""
  })

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  function handleTurnstileVerify(token: string) {
    setTurnstileToken(token)
    setIsTurnstileVerified(true)
  }

  function handleTurnstileError() {
    setTurnstileToken(null)
    setIsTurnstileVerified(false)
  }

  function handleTurnstileExpire() {
    setTurnstileToken(null)
    setIsTurnstileVerified(false)
  }

  // Reset Turnstile when modal closes
  const handleBookingOpenChange = (open: boolean) => {
    setBookingOpen(open)
    if (!open) {
      // Reset form and Turnstile when modal closes
      setFormData({
        name: "",
        email: "",
        phone: "",
        guests: "",
        eventType: "",
        introduction: "",
        biography: "",
        specialRequests: ""
      })
      setSelectedDate(undefined)
      setTurnstileToken(null)
      setIsTurnstileVerified(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validate Turnstile
    if (!isTurnstileVerified || !turnstileToken) {
      alert("Please complete the CAPTCHA verification first.")
      return
    }
    
    // Validate required fields
    if (!selectedDate) {
      alert("Please select a desired date.")
      return
    }
    if (!formData.guests) {
      alert("Please select the number of guests.")
      return
    }
    if (!formData.eventType) {
      alert("Please select an event type.")
      return
    }
    
    setIsSubmitting(true)
    
    try {
      const response = await fetch("/api/booking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: turnstileToken,
          ...formData,
          date: selectedDate?.toISOString(),
        }),
      })
      
      const data = await response.json()
      
      if (!data.success) {
        throw new Error(data.error || "Failed to submit booking")
      }
      
      alert("Thank you for your reservation request! We'll be in touch soon.")
      setFormData({
        name: "",
        email: "",
        phone: "",
        guests: "",
        eventType: "",
        introduction: "",
        biography: "",
        specialRequests: ""
      })
      setSelectedDate(undefined)
      setTurnstileToken(null)
      setIsTurnstileVerified(false)
      setBookingOpen(false)
    } catch (error) {
      console.error("Booking submission error:", error)
      alert("Failed to submit booking. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  // Header height is provided via CSS defaults in globals to avoid first-paint jumps.

  return (
    <header ref={headerRef} className="absolute top-0 left-0 right-0 z-50 px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-2 sm:py-3 md:py-4 lg:py-6 no-horiz-overflow">
      {/* Top Row */}
      <div className="flex items-center justify-between max-w-none mx-auto mb-0 lg:mb-0 min-w-0 relative">
        {/* Logo (hidden ≤425px) */}
        <Link href="/" aria-label="Hell University Home" className="hidden lg:flex items-center justify-center ml-1 md:ml-0">
          <div className="flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 lg:w-20 lg:h-20 3xl:w-24 3xl:h-24 4xl:w-28 4xl:h-28 5xl:w-32 5xl:h-32 rounded-full bg-white border-2 lg:border-4 3xl:border-[6px] 4xl:border-8 border-[var(--hell-dusty-blue)]">
            <img src={withBasePath('/assets/icons/icon_helluniversity.svg')} alt="Hell University" width={62} height={62} className="w-10 h-10 sm:w-11 sm:h-11 md:w-12 md:h-12 lg:w-16 lg:h-16 3xl:w-[4.5rem] 3xl:h-[4.5rem] 4xl:w-[5rem] 4xl:h-[5rem] 5xl:w-[6rem] 5xl:h-[6rem]" />
          </div>
        </Link>

        {/* Title - wraps on very small screens to avoid overlap; single line from phone and up */}
                <h1 className="flex-1 text-left font-heading font-black tracking-wide whitespace-normal lg:whitespace-nowrap lg:absolute lg:left-1/2 lg:-translate-x-1/2 lg:text-center max-w-[80vw] lg:max-w-none text-xl sm:text-2xl md:text-3xl lg:text-5xl 3xl:text-6xl 4xl:text-7xl 5xl:text-8xl">
          <span className="text-[var(--hell-dusty-blue)] font-urbanist font-extrabold leading-[1.2]">Hell</span>{' '}
          <span className="text-[#2a1f1a] font-urbanist font-extrabold leading-[1.2]">University</span>
        </h1>

        {/* Booking Button */}
        <Dialog open={bookingOpen} onOpenChange={handleBookingOpenChange}>
          <DialogTrigger className="hidden lg:flex items-center gap-3 text-white/80 hover:text-white transition-colors mr-1 sm:mr-2 md:mr-3 lg:mr-0" aria-label="Open Booking">
            <div className="flex items-center justify-center w-10 h-10 lg:w-12 lg:h-12 3xl:w-14 3xl:h-14 4xl:w-16 4xl:h-16 5xl:w-20 5xl:h-20 rounded-full bg-white border-2 border-[var(--hell-dusty-blue)]">
              <CalendarIcon className="w-5 h-5 lg:w-6 lg:h-6 3xl:w-7 3xl:h-7 4xl:w-8 4xl:h-8 5xl:w-10 5xl:h-10 text-[var(--hell-dusty-blue)]" />
            </div>
            <span className="hidden lg:inline font-comfortaa font-normal text-sm lg:text-base 3xl:text-lg">Booking</span>
          </DialogTrigger>

          {/* Mobile/Tablet trigger placed next to burger (≤1023px) */}
          <DialogTrigger className="lg:hidden flex items-center gap-2 text-white/80 hover:text-white transition-colors absolute right-16 sm:right-20 md:right-24 top-1/2 -translate-y-1/2" aria-label="Open Booking">
            <div className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white border-2 border-[var(--hell-dusty-blue)]">
              <CalendarIcon className="w-5 h-5 text-[var(--hell-dusty-blue)]" />
            </div>
            <span className="hidden sm:inline font-comfortaa font-normal text-sm md:text-base">Booking</span>
          </DialogTrigger>

          <DialogContent className="top-0 left-0 translate-x-0 translate-y-0 w-full h-screen max-w-none sm:max-w-none rounded-none border-0 p-0 bg-transparent overflow-hidden">
            <DialogHeader className="sr-only">
              <DialogTitle>Booking</DialogTitle>
              <DialogDescription>Menu and Booking modal</DialogDescription>
            </DialogHeader>
            <div className="relative h-full flex flex-col overflow-hidden">
              <div className="flex flex-col lg:flex-row h-full min-h-0">
                {/* Left Side - Hero-like panel */}
                <div className="w-full lg:w-1/2 bg-[#5B9AB8] flex flex-col justify-center xl:pl-12 2xl:pl-16 py-6 sm:py-8 md:py-10 lg:py-8 xl:py-10 shrink-0 overflow-y-auto">
                  <div className="max-w-xl px-6 sm:px-8 md:px-10 lg:px-8 xl:px-10">
                    <h1 className="mb-4 sm:mb-6 lg:mb-6 xl:mb-8 font-heading" style={{ fontSize: 'clamp(32px, 4vw, 56px)', fontWeight: '900', lineHeight: '0.9', color: '#5a3a2a' }}>
                      Hell<br />University
                    </h1>
                    <h2 className="text-white mb-4 sm:mb-6 lg:mb-6 xl:mb-8 font-comfortaa" style={{ fontSize: 'clamp(20px, 2.5vw, 28px)', fontWeight: '400' }}>
                      Menu
                    </h2>
                    <nav className="grid grid-cols-2 gap-2 sm:gap-3 text-white/95">
                      <Link href="/" className="hover:text-white/80 transition-colors font-comfortaa text-sm sm:text-base" aria-label="Home">Home</Link>
                      <Link href="/about" className="hover:text-white/80 transition-colors font-comfortaa text-sm sm:text-base" aria-label="About">About</Link>
                      <Link href="/studio-gallery" className="hover:text-white/80 transition-colors font-comfortaa text-sm sm:text-base" aria-label="Studio & Gallery">Studio/Gallery</Link>
                      <Link href="/contact" className="hover:text-white/80 transition-colors font-comfortaa text-sm sm:text-base" aria-label="Contact">Contact</Link>
                    </nav>
                  </div>
                </div>

                {/* Right Side - Booking Form */}
                <div className="w-full lg:w-1/2 bg-[#f4f1ed] flex items-start lg:items-center justify-center min-h-0 overflow-y-auto lg:overflow-y-visible" style={{ padding: 'clamp(1rem, 1.2vw, 1.5rem) clamp(0.75rem, 1vw, 1.5rem)' }}>
                  <div className="w-full max-w-xl lg:max-w-lg xl:max-w-xl bg-white/90 border rounded-lg shadow-lg" style={{ padding: 'clamp(0.75rem, 1vw, 1.5rem)' }}>
                    <div style={{ marginBottom: 'clamp(0.5rem, 0.8vw, 1rem)' }}>
                      <h3 className="text-[#5a3a2a] font-comfortaa mb-1" style={{ fontSize: 'clamp(1.125rem, 1.4vw, 1.25rem)', fontWeight: '700' }}>
                        Reservation Inquiry
                      </h3>
                      <p className="text-[#5a3a2a]/70 font-comfortaa leading-tight" style={{ fontSize: 'clamp(0.6875rem, 0.75vw, 0.8125rem)', fontWeight: '300' }}>
                        Share your vision with us and allow our curators to craft an extraordinary experience tailored to your unique sensibilities.
                      </p>
                    </div>

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.75rem, 0.9vw, 1rem)' }}>
                      {/* Turnstile CAPTCHA - Must be verified before using the form */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.375rem, 0.5vw, 0.5rem)', paddingBottom: 'clamp(0.375rem, 0.5vw, 0.5rem)', borderBottom: '1px solid rgb(229 231 235)' }}>
                        <p className="text-[#5a3a2a]/70 font-comfortaa" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
                          Please verify you're human before proceeding:
                        </p>
                        <div className="lg:scale-75 xl:scale-90 origin-left">
                          <Turnstile
                            onVerify={handleTurnstileVerify}
                            onError={handleTurnstileError}
                            onExpire={handleTurnstileExpire}
                            size="compact"
                          />
                        </div>
                        {!isTurnstileVerified && (
                          <p className="text-[#5a3a2a]/60 font-comfortaa italic" style={{ fontSize: 'clamp(0.625rem, 0.7vw, 0.75rem)' }}>
                            Complete verification to enable form fields
                          </p>
                        )}
                      </div>

                      {/* Basic Information */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.375rem, 0.5vw, 0.5rem)' }}>
                        <h4 className="text-[#5a3a2a] font-comfortaa font-semibold" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}>Basic Information</h4>
                        <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 'clamp(0.375rem, 0.5vw, 0.75rem)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label htmlFor="name" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Full Name *</Label>
                            <Input
                              id="name"
                              required
                              value={formData.name}
                              onChange={(e) => handleInputChange("name", e.target.value)}
                              placeholder="Your full name"
                              disabled={!isTurnstileVerified}
                              className={`font-comfortaa ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label htmlFor="email" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Email Address *</Label>
                            <Input
                              id="email"
                              type="email"
                              required
                              value={formData.email}
                              onChange={(e) => handleInputChange("email", e.target.value)}
                              placeholder="your@email.com"
                              disabled={!isTurnstileVerified}
                              className={`font-comfortaa ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label htmlFor="phone" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Phone Number *</Label>
                            <Input
                              id="phone"
                              required
                              value={formData.phone}
                              onChange={(e) => handleInputChange("phone", e.target.value)}
                              placeholder="+1 (555) 123-4567"
                              disabled={!isTurnstileVerified}
                              className={`font-comfortaa ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label htmlFor="guests" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Number of Guests *</Label>
                            <Select value={formData.guests} onValueChange={(value) => handleInputChange("guests", value)} disabled={!isTurnstileVerified}>
                              <SelectTrigger className={`font-comfortaa ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed" : ""}`} style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}>
                                <SelectValue placeholder="Select guest count" />
                              </SelectTrigger>
                              <SelectContent>
                                {Array.from({ length: 15 }, (_, i) => i + 1).map((num) => (
                                  <SelectItem key={num} value={num.toString()}>
                                    {num} {num === 1 ? "guest" : "guests"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      {/* Event Details */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.375rem, 0.5vw, 0.5rem)' }}>
                        <h4 className="text-[#5a3a2a] font-comfortaa font-semibold" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}>Event Details</h4>
                        <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 'clamp(0.375rem, 0.5vw, 0.75rem)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Desired Date *</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  disabled={!isTurnstileVerified}
                                  className={`w-full justify-start text-left font-normal font-comfortaa ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed" : ""}`}
                                  style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}
                                >
                                  <CalendarIcon className="mr-2" style={{ width: 'clamp(0.75rem, 0.8vw, 1rem)', height: 'clamp(0.75rem, 0.8vw, 1rem)' }} />
                                  {selectedDate ? format(selectedDate, "PPP") : "Pick a date"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                  mode="single"
                                  selected={selectedDate}
                                  onSelect={setSelectedDate}
                                  disabled={(date) => date < new Date() || !isTurnstileVerified}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.25rem, 0.3vw, 0.375rem)' }}>
                            <Label htmlFor="eventType" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Event Type *</Label>
                            <Select value={formData.eventType} onValueChange={(value) => handleInputChange("eventType", value)} disabled={!isTurnstileVerified}>
                              <SelectTrigger className={`font-comfortaa ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed" : ""}`} style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', height: 'clamp(2rem, 2.2vw, 2.25rem)' }}>
                                <SelectValue placeholder="Select event type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="reunion">Reunion</SelectItem>
                                <SelectItem value="family-friends">Family & Friends</SelectItem>
                                <SelectItem value="baby-shower">Baby Shower</SelectItem>
                                <SelectItem value="engagement">Engagement</SelectItem>
                                <SelectItem value="art-workshop">Art Workshop</SelectItem>
                                <SelectItem value="painting-workshop">Painting Workshop</SelectItem>
                                <SelectItem value="ceramics-workshop">Ceramics Workshop</SelectItem>
                                <SelectItem value="brainstorming-session">Brainstorming Session</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      {/* Personal Information */}
                      <div className="space-y-2 sm:space-y-3 lg:space-y-1.5">
                        <h4 className="text-[#5a3a2a] font-comfortaa font-semibold" style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)' }}>Share Your Story</h4>
                        <div className="space-y-2 sm:space-y-2.5 lg:space-y-1.5">
                          <div className="space-y-1">
                            <Label htmlFor="introduction" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Brief Introduction *</Label>
                            <Textarea
                              id="introduction"
                              required
                              value={formData.introduction}
                              onChange={(e) => handleInputChange("introduction", e.target.value)}
                              placeholder={isTurnstileVerified ? "Tell us a bit about yourself..." : "Please complete CAPTCHA verification first..."}
                              disabled={!isTurnstileVerified}
                              rows={2}
                              className={`font-comfortaa resize-none ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', minHeight: 'clamp(3rem, 3.5vw, 4rem)' }}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="biography" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Background & Interests</Label>
                            <Textarea
                              id="biography"
                              value={formData.biography}
                              onChange={(e) => handleInputChange("biography", e.target.value)}
                              placeholder={isTurnstileVerified ? "Share your interests, profession..." : "Please complete CAPTCHA verification first..."}
                              disabled={!isTurnstileVerified}
                              rows={2}
                              className={`font-comfortaa resize-none ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', minHeight: 'clamp(3rem, 3.5vw, 4rem)' }}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="specialRequests" className="text-[#5a3a2a] font-comfortaa" style={{ fontSize: 'clamp(0.6875rem, 0.7vw, 0.75rem)' }}>Special Requests or Vision</Label>
                            <Textarea
                              id="specialRequests"
                              value={formData.specialRequests}
                              onChange={(e) => handleInputChange("specialRequests", e.target.value)}
                              placeholder={isTurnstileVerified ? "Describe your vision, special requirements..." : "Please complete CAPTCHA verification first..."}
                              disabled={!isTurnstileVerified}
                              rows={2}
                              className={`font-comfortaa resize-none ${!isTurnstileVerified ? "opacity-50 cursor-not-allowed bg-gray-100" : ""}`}
                              style={{ fontSize: 'clamp(0.75rem, 0.8vw, 0.875rem)', minHeight: 'clamp(3rem, 3.5vw, 4rem)' }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Submit Button */}
                      <div className="flex flex-col items-center space-y-1.5 sm:space-y-2 lg:space-y-1 pt-2 sm:pt-2.5 lg:pt-1.5">
                        <Button
                          type="submit"
                          disabled={!isTurnstileVerified || isSubmitting}
                          className="font-comfortaa bg-[#5B9AB8] hover:bg-[#4d8ea7] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ 
                            padding: 'clamp(0.5rem, 0.6vw, 0.75rem) clamp(1rem, 1.2vw, 1.5rem)',
                            fontSize: 'clamp(0.75rem, 0.85vw, 0.875rem)'
                          }}
                        >
                          {isSubmitting ? "Submitting..." : "Submit Inquiry"}
                        </Button>
                        <p className="text-[#5a3a2a]/70 text-center max-w-lg font-comfortaa leading-tight px-2" style={{ fontSize: 'clamp(0.5625rem, 0.6vw, 0.625rem)' }}>
                          Your inquiry will be carefully reviewed by our curation team. We honor each request with thoughtful consideration and will respond within 48 hours.
                        </p>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="lg:hidden text-white p-2 sm:p-3 sm:absolute sm:right-4 sm:top-1/2 sm:-translate-y-1/2"
          aria-label="Toggle navigation"
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>


      {/* Bottom Row: Desktop Nav */}
      <nav className="hidden lg:flex items-center justify-center gap-8 lg:gap-14 xl:gap-16 max-w-none mx-auto mb-0 lg:mb-0">
        <Link href="/" className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">Home</Link>
        <Link href="/about" className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">About</Link>
        <Link href="/studio-gallery" className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">Studio/Gallery</Link>
        <Link href="/contact" className="transition-colors text-white hover:text-white font-comfortaa text-[clamp(18px,1.2vw,28px)] font-normal">Contact</Link>
      </nav>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-[#2a2520]/95 backdrop-blur-sm">
          <nav className="flex flex-col items-center justify-center h-full gap-8 mb-0 lg:mb-0">
            {/* Logo shown at top of menu on small screens */}
            <div className="mb-4">
              <div className="flex items-center justify-center w-[64px] h-[64px] rounded-full bg-white border-2 border-[var(--hell-dusty-blue)]">
                <img src={withBasePath('/assets/icons/icon_helluniversity.svg')} alt="Hell University" width={56} height={56} className="w-[56px] h-[56px]" />
              </div>
            </div>
            <Link href="/" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>Home</Link>
            <Link href="/about" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>About</Link>
            <Link href="/studio-gallery" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>Studio/Gallery</Link>
            <Link href="/contact" onClick={() => setMobileMenuOpen(false)} className="transition-colors text-white/80 hover:text-white font-comfortaa" style={{ fontSize: '22px', fontWeight: '400' }}>Contact</Link>
          </nav>
        </div>
      )}
    </header>
  )
}