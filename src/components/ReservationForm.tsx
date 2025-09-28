'use client'

import { useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { CalendarIcon, Upload } from "lucide-react";
import { format } from "date-fns";

export function ReservationForm() {
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    guests: "",
    eventType: "",
    introduction: "",
    biography: "",
    specialRequests: ""
  });

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle form submission here
    console.log("Form submitted:", { ...formData, date: selectedDate });
    alert("Thank you for your reservation request! We'll be in touch soon.");
  };

  return (
    <section id="reservation" className="py-24 sm:py-32 kade-light-texture relative overflow-hidden">
      {/* Kade's artwork inspired paint strokes and textures */}
      <div className="absolute inset-0">
        {/* Large textured panels inspired by the collage */}
        <div className="absolute top-0 left-0 w-1/3 h-full kade-red-texture opacity-80"></div>
        <div className="absolute top-0 right-0 w-1/4 h-2/3 kade-dark-texture opacity-70"></div>
        <div className="absolute bottom-0 left-1/4 w-1/2 h-1/3 kade-yellow-texture opacity-60"></div>
        <div className="absolute top-1/3 right-1/3 w-1/3 h-1/3 kade-purple-texture opacity-50"></div>
        
        {/* Paint stroke decorations */}
        <div className="absolute top-32 left-48 kade-paint-stroke kade-paint-stroke-yellow"></div>
        <div className="absolute top-64 right-56 kade-paint-stroke kade-paint-stroke-red"></div>
        <div className="absolute bottom-48 left-32 kade-paint-stroke kade-paint-stroke-purple"></div>
        <div className="absolute bottom-32 right-32 kade-paint-stroke kade-paint-stroke-yellow"></div>
        <div className="absolute top-1/2 left-1/4 kade-paint-stroke kade-paint-stroke-red"></div>
        
        {/* Overlay for content readability */}
        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm"></div>
      </div>
      
      <div className="container mx-auto px-6 lg:px-8 max-w-5xl relative z-10">
        <div className="text-center mb-20">
          <div className="space-y-6">
            <h1 className="hell-university-hero" style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)' }}>
              Begin Your Reservation
            </h1>
            <div className="w-24 h-px bg-[#7ba3a3] mx-auto"></div>
            <p className="text-lg text-[#6b655c] leading-relaxed max-w-3xl mx-auto font-medium">
              Share your vision with us and allow our curators to craft 
              an extraordinary experience tailored to your unique sensibilities.
            </p>
          </div>
        </div>

        <div className="kade-card">
          <div className="text-center pb-8 relative">
            {/* Artistic header decoration */}
            <div className="absolute top-0 left-1/4 w-16 h-3 bg-red-500 transform -rotate-3"></div>
            <div className="absolute top-2 right-1/4 w-12 h-2 bg-yellow-400 transform rotate-5"></div>
            
            <h2 className="hell-university-section-title text-3xl uppercase">Reservation Inquiry</h2>
            <p className="text-sm text-black mt-4 max-w-2xl mx-auto font-medium">
              Each reservation is thoughtfully reviewed to ensure an exceptional experience 
              that aligns with our philosophy of intimate, curated gatherings.
            </p>
          </div>
          
          <div className="space-y-8">
            <form onSubmit={handleSubmit} className="space-y-8">
              {/* Basic Information - Red Section */}
              <div className="kade-form-section kade-form-section-red">
                <h3 className="text-xl text-white mb-6 uppercase tracking-wide font-bold">Basic Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <label htmlFor="name" className="kade-label text-white block">Full Name *</label>
                    <input
                      id="name"
                      required
                      value={formData.name}
                      onChange={(e) => handleInputChange("name", e.target.value)}
                      placeholder="Your full name"
                      className="kade-input w-full"
                    />
                  </div>
                  
                  <div className="space-y-3">
                    <label htmlFor="email" className="kade-label text-white block">Email Address *</label>
                    <input
                      id="email"
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => handleInputChange("email", e.target.value)}
                      placeholder="your@email.com"
                      className="kade-input w-full"
                    />
                  </div>
                  
                  <div className="space-y-3">
                    <label htmlFor="phone" className="kade-label text-white block">Phone Number *</label>
                    <input
                      id="phone"
                      required
                      value={formData.phone}
                      onChange={(e) => handleInputChange("phone", e.target.value)}
                      placeholder="+1 (555) 123-4567"
                      className="kade-input w-full"
                    />
                  </div>
                  
                  <div className="space-y-3">
                    <label htmlFor="guests" className="kade-label text-white block">Number of Guests *</label>
                    <Select onValueChange={(value) => handleInputChange("guests", value)}>
                      <SelectTrigger className="kade-select w-full h-[48px]">
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

              {/* Event Details - Yellow Section */}
              <div className="kade-form-section kade-form-section-yellow">
                <h3 className="text-xl font-bold text-black mb-6 uppercase tracking-wide">Event Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <label className="kade-label text-black block">Desired Date *</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full h-[48px] justify-start text-left font-normal border-black flex items-center px-4 bg-[var(--kade-light-texture)] border-3 border-solid text-[var(--kade-black)]"
                        >
                          <CalendarIcon className="h-4 w-4" style={{ marginTop: '1px' }} />
                          <span className="ml-1" style={{ marginTop: '1px' }}>
                            {selectedDate ? format(selectedDate, "PPP") : "Pick a date"}
                          </span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={selectedDate}
                          onSelect={setSelectedDate}
                          disabled={(date) => date < new Date()}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  
                  <div className="space-y-3">
                    <label htmlFor="eventType" className="kade-label text-black block">Event Type *</label>
                    <Select onValueChange={(value) => handleInputChange("eventType", value)}>
                      <SelectTrigger className="kade-select w-full h-[48px]">
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

              {/* Personal Information - Dark Section */}
              <div className="kade-form-section kade-form-section-dark">
                <div className="text-center mb-8">
                  <h3 className="text-2xl font-bold text-white tracking-wide uppercase">
                    Share Your Story
                  </h3>
                  <p className="text-sm text-gray-200 font-medium mt-2">
                    Help us understand your vision to create the perfect intimate experience
                  </p>
                </div>
                
                <div className="space-y-6">
                  <div className="space-y-3">
                    <label htmlFor="introduction" className="kade-label text-white block">Brief Introduction *</label>
                    <textarea
                      id="introduction"
                      required
                      value={formData.introduction}
                      onChange={(e) => handleInputChange("introduction", e.target.value)}
                      placeholder="Tell us a bit about yourself and what brings you to Hell University..."
                      rows={3}
                      className="kade-textarea w-full"
                    />
                  </div>
                  
                  <div className="space-y-3">
                    <label htmlFor="biography" className="kade-label text-white block">Background & Interests</label>
                    <textarea
                      id="biography"
                      value={formData.biography}
                      onChange={(e) => handleInputChange("biography", e.target.value)}
                      placeholder="Share your interests, profession, or anything that helps us understand your style and preferences..."
                      rows={4}
                      className="kade-textarea w-full"
                    />
                  </div>
                  
                  <div className="space-y-3">
                    <label htmlFor="photo" className="kade-label text-white block">Photo Upload (Optional)</label>
                    <div className="border-4 border-dashed border-white/60 p-6 hover:border-yellow-400 transition-colors bg-white/10 backdrop-blur-sm">
                      <div className="flex flex-col items-center justify-center space-y-4">
                        <Upload className="h-12 w-12 text-white/80" />
                        <button type="button" className="kade-button-secondary">
                          Choose File
                        </button>
                        <p className="text-sm text-gray-200 text-center">
                          Upload a photo to help us get to know you better
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <label htmlFor="specialRequests" className="kade-label text-white block">Special Requests or Vision</label>
                    <textarea
                      id="specialRequests"
                      value={formData.specialRequests}
                      onChange={(e) => handleInputChange("specialRequests", e.target.value)}
                      placeholder="Describe your vision, any special requirements, dietary restrictions, or how you'd like us to help make your event unique..."
                      rows={4}
                      className="kade-textarea w-full"
                    />
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex flex-col items-center space-y-6 pt-8 relative">
                {/* Artistic decorations around submit button */}
                <div className="absolute top-4 left-1/4 w-20 h-4 bg-purple-600 transform -rotate-12"></div>
                <div className="absolute top-6 right-1/4 w-16 h-3 bg-red-500 transform rotate-8"></div>
                
                <button
                  type="submit"
                  className="kade-button text-lg px-20 py-5"
                >
                  Submit Inquiry
                </button>
                <p className="text-xs text-black text-center max-w-lg font-medium leading-relaxed bg-white/80 p-4 border-2 border-black">
                  Your inquiry will be carefully reviewed by our curation team. 
                  We honor each request with thoughtful consideration and will respond within 48 hours.
                </p>
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}