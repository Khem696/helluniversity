'use client'

import { useState } from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Card } from "./ui/card";
import { Sparkles, SkipForward } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";

export function AISpaceGenerator() {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    
    setIsGenerating(true);
    
    // Simulate AI generation delay
    setTimeout(() => {
      // Mock generated image - in real implementation, this would call an AI service
      setGeneratedImage("https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&h=600&fit=crop");
      setIsGenerating(false);
    }, 3000);
  };

  const scrollToReservation = () => {
    const reservationSection = document.getElementById('reservation');
    if (reservationSection) {
      reservationSection.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <section id="ai-generator" className="min-h-screen flex items-center justify-center kade-light-texture relative overflow-hidden">
      {/* Kade's artwork inspired background elements */}
      <div className="absolute inset-0">
        {/* Large textured panels */}
        <div className="absolute top-0 left-0 w-1/4 h-2/3 kade-purple-texture opacity-60"></div>
        <div className="absolute bottom-0 right-0 w-1/3 h-1/2 kade-red-texture opacity-70"></div>
        <div className="absolute top-1/3 left-1/3 w-1/3 h-1/3 kade-yellow-texture opacity-50"></div>
        
        {/* Paint stroke decorations */}
        <div className="absolute top-24 right-40 kade-paint-stroke kade-paint-stroke-red"></div>
        <div className="absolute top-56 left-24 kade-paint-stroke kade-paint-stroke-yellow"></div>
        <div className="absolute bottom-32 right-24 kade-paint-stroke kade-paint-stroke-purple"></div>
        <div className="absolute bottom-56 left-40 kade-paint-stroke kade-paint-stroke-yellow"></div>
        
        {/* Overlay for content readability */}
        <div className="absolute inset-0 bg-white/85 backdrop-blur-sm"></div>
      </div>
      
      <div className="max-w-7xl mx-auto px-6 lg:px-8 relative z-10 w-full">
        <div className="text-center mb-20">
          <div className="space-y-6">
            <div className="flex items-center justify-center space-x-3">
              <Sparkles className="w-6 h-6 text-[#7ba3a3]" />
              <h1 className="hell-university-hero" style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)' }}>
                Visualize Your Vision
              </h1>
              <Sparkles className="w-6 h-6 text-[#7ba3a3]" />
            </div>
            <div className="w-24 h-px bg-[#7ba3a3] mx-auto"></div>
            <p className="text-lg text-[#6b655c] max-w-4xl mx-auto leading-relaxed font-medium">
              Articulate your aesthetic vision and witness our AI curator transform 
              Hell University to reflect your unique sensibilities.
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-16 items-start">
          {/* Input Section */}
          <div className="space-y-8">
            <div className="kade-card">
              <div className="space-y-6 relative">
                {/* Artistic decorations */}
                <div className="absolute -top-2 -right-2 w-8 h-2 bg-yellow-400 transform rotate-12"></div>
                <div className="absolute top-4 -left-2 w-6 h-2 bg-red-500 transform -rotate-8"></div>
                
                <label className="kade-label block text-black">
                  Describe Your Aesthetic Vision
                </label>
                <textarea
                  placeholder="Share your design sensibilities: Perhaps bold artistic expressions with vibrant color contrasts, textured surfaces, experimental lighting, and avant-garde installations that speak to creative rebellion..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="kade-textarea w-full min-h-40"
                />
                <button
                  onClick={handleGenerate}
                  disabled={!prompt.trim() || isGenerating}
                  className="kade-button w-full text-base py-4"
                >
                  {isGenerating ? (
                    <>
                      <Sparkles className="w-4 h-4 animate-spin" />
                      Crafting Your Vision...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate Vision
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Action Button */}
            <div className="space-y-4">
              <button
                onClick={scrollToReservation}
                className="kade-button-secondary w-full text-base py-4"
              >
                <SkipForward className="w-4 h-4" />
                Continue to Reservation
              </button>
            </div>
          </div>

          {/* Preview Section */}
          <div className="space-y-8">
            <div className="kade-card overflow-hidden">
              <div className="aspect-[4/3] bg-[#e8e3db]/30 flex items-center justify-center relative">
                {isGenerating ? (
                  <div className="text-center space-y-6">
                    <div className="w-20 h-20 mx-auto">
                      <Sparkles className="w-20 h-20 text-accent animate-pulse" />
                    </div>
                    <div className="space-y-3">
                      <div className="text-[#3a3530] font-medium">Curating your aesthetic...</div>
                      <div className="text-sm text-[#6b655c]">Translating vision into reality</div>
                    </div>
                  </div>
                ) : generatedImage ? (
                  <div className="relative w-full h-full group">
                    <ImageWithFallback
                      src={generatedImage}
                      alt="AI Generated Space Design"
                      className="w-full h-full object-cover"
                      width={800}
                      height={600}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  </div>
                ) : (
                  <div className="text-center space-y-6 px-8">
                    <div className="w-28 h-28 mx-auto bg-muted rounded-sm flex items-center justify-center">
                      <Sparkles className="w-14 h-14 text-muted-foreground" />
                    </div>
                    <div className="space-y-3">
                      <div className="text-muted-foreground font-medium">Your curated design will appear here</div>
                      <div className="text-sm text-muted-foreground/70">Share your vision to begin the transformation</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {generatedImage && (
              <div className="kade-form-section kade-form-section-yellow relative">
                <div className="absolute top-2 right-4 w-12 h-3 bg-red-500 transform rotate-6"></div>
                <div className="text-center space-y-3">
                  <div className="text-black font-bold text-lg uppercase">✦ Your Vision Has Been Realized</div>
                  <div className="text-sm text-black font-medium">
                    Ready to transform this concept into your extraordinary event?
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Benefits */}
        {/* <div className="mt-24 grid md:grid-cols-3 gap-12 text-center">
          <div className="space-y-4">
            <div className="w-16 h-16 mx-auto bg-accent/10 rounded-sm flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-accent" />
            </div>
            <h3 className="text-foreground font-medium tracking-wide">Instant Realization</h3>
            <p className="text-sm text-muted-foreground font-light leading-relaxed">
              Witness your aesthetic vision materialized before commitment
            </p>
          </div>
          
          <div className="space-y-4">
            <div className="w-16 h-16 mx-auto bg-accent/10 rounded-sm flex items-center justify-center">
              <ArrowRight className="w-8 h-8 text-accent" />
            </div>
            <h3 className="text-foreground font-medium tracking-wide">Precision Planning</h3>
            <p className="text-sm text-muted-foreground font-light leading-relaxed">
              Ensure harmonious alignment between vision and venue
            </p>
          </div>
          
          <div className="space-y-4">
            <div className="w-16 h-16 mx-auto bg-accent/10 rounded-sm flex items-center justify-center">
              <SkipForward className="w-8 h-8 text-accent" />
            </div>
            <h3 className="text-foreground font-medium tracking-wide">Flexible Approach</h3>
            <p className="text-sm text-muted-foreground font-light leading-relaxed">
              Explore possibilities or proceed directly to reservation
            </p>
          </div>
        </div> */}
      </div>
    </section>
  );
}