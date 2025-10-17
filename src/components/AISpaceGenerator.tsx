'use client'

import { useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Card } from "./ui/card";
import { Sparkles, SkipForward } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { GALLERY_IMAGES, HONGSEE_IMAGES } from "@/lib/aispaces";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "./ui/dialog";

export function AISpaceGenerator() {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim() || selectedImages.length === 0) return;
    setIsGenerating(true);
    setGeneratedImages([]);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: selectedImages, prompt }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Generation failed");
      }
      const data = await res.json();
      if (Array.isArray(data?.images)) {
        setGeneratedImages(data.images);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleSelect = (url: string) => {
    setSelectedImages((prev) => {
      const exists = prev.includes(url);
      if (exists) return prev.filter((u) => u !== url);
      if (prev.length >= 10) return prev; // cap at 10
      return [...prev, url];
    });
  };

  const isValidToGenerate = useMemo(() => {
    return prompt.trim().length > 0 && selectedImages.length > 0 && !isGenerating;
  }, [prompt, selectedImages, isGenerating]);

  const scrollToReservation = () => {
    const reservationSection = document.getElementById('reservation');
    if (reservationSection) {
      reservationSection.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <section id="ai-generator" className="min-h-screen flex items-center justify-center kade-blue-wash kade-no-anim relative overflow-hidden">
      {/* Kade's artwork inspired background elements */}
      <div className="absolute inset-0">
        {/* Large textured panels */}
        <div className="absolute top-0 left-0 w-1/5 h-2/3 kade-purple-texture opacity-60"></div>
        <div className="absolute bottom-0 right-0 w-1/3 h-1/2 kade-red-texture opacity-70"></div>
        <div className="absolute top-1/4 left-1/3 w-2/5 h-1/3 kade-yellow-texture opacity-50"></div>
        
        {/* Paint stroke decorations */}
        <div className="absolute top-24 right-40 kade-paint-stroke kade-paint-stroke-red"></div>
        <div className="absolute top-56 left-24 kade-paint-stroke kade-paint-stroke-yellow"></div>
        <div className="absolute bottom-32 right-24 kade-paint-stroke kade-paint-stroke-purple"></div>
        <div className="absolute bottom-56 left-40 kade-paint-stroke kade-paint-stroke-yellow"></div>
        
        {/* Back-layer speckles and noise */}
        <div className="absolute inset-0 kade-speckles kade-speckles--cobalt kade-no-anim"></div>
        <div className="absolute inset-0 kade-noise kade-no-anim"></div>
        {/* Overlay for content readability */}
        <div className="absolute inset-0 bg-white/10"></div>
      </div>
      
      <div className="max-w-7xl mx-auto px-6 lg:px-8 relative z-10 w-full pt-4 md:pt-8 lg:pt-12">
        <div className="text-center mb-20">
          <div className="space-y-6">
            <div className="flex items-center justify-center space-x-3">
              <Sparkles className="w-6 h-6 text-[#7ba3a3]" />
              <h1 className="hell-university-hero kade-scribble-underline" style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)' }}>
                Visualize Your Vision
              </h1>
              <Sparkles className="w-6 h-6 text-[#7ba3a3]" />
            </div>
            <div className="w-24 h-px bg-[#7ba3a3] mx-auto"></div>
            <p className="text-lg text-[#ffffff] max-w-4xl mx-auto leading-relaxed font-medium">
              Articulate your aesthetic vision and witness our AI curator transform 
              Hell University to reflect your unique sensibilities.
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-16 items-start">
          {/* Input Section */}
          <div className="space-y-8">
            <div className="kade-card">
              <div className="space-y-6">
                <label className="kade-label block text-black">Select Space Photos</label>
                <Dialog open={isPickerOpen} onOpenChange={setIsPickerOpen}>
                  <DialogTrigger asChild>
                    <button className="kade-button-secondary w-full text-base py-3">
                      Choose Photos (Selected: {selectedImages.length} / 10)
                    </button>
                  </DialogTrigger>
                  <DialogContent className="max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>Select Space Photos</DialogTitle>
                      <DialogDescription>
                        Pick at least 1 and up to 10 images from Hongsee Space and Archive Gallery.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6">
                      <div>
                        <div className="text-sm font-semibold mb-2">Hongsee Space</div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {HONGSEE_IMAGES.map((url) => {
                            const selected = selectedImages.includes(url);
                            return (
                              <button
                                type="button"
                                key={url}
                                onClick={() => toggleSelect(url)}
                                className={`relative aspect-square overflow-hidden border ${selected ? "border-black ring-2 ring-black" : "border-transparent"}`}
                                aria-pressed={selected}
                                aria-label={selected ? "Deselect image" : "Select image"}
                              >
                                <ImageWithFallback
                                  src={url}
                                  alt="Hongsee Space"
                                  className="w-full h-full object-cover"
                                  width={400}
                                  height={400}
                                />
                                {selected && <div className="absolute inset-0 bg-black/25" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <div className="text-sm font-semibold mb-2">Archive Gallery</div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {GALLERY_IMAGES.map((url) => {
                            const selected = selectedImages.includes(url);
                            return (
                              <button
                                type="button"
                                key={url}
                                onClick={() => toggleSelect(url)}
                                className={`relative aspect-square overflow-hidden border ${selected ? "border-black ring-2 ring-black" : "border-transparent"}`}
                                aria-pressed={selected}
                                aria-label={selected ? "Deselect image" : "Select image"}
                              >
                                <ImageWithFallback
                                  src={url}
                                  alt="Archive Gallery"
                                  className="w-full h-full object-cover"
                                  width={400}
                                  height={400}
                                />
                                {selected && <div className="absolute inset-0 bg-black/25" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <div>Selected: {selectedImages.length} / 10</div>
                        <button
                          type="button"
                          className="underline"
                          onClick={() => setSelectedImages([])}
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <DialogFooter>
                      <DialogClose asChild>
                        <button className="kade-button w-full sm:w-auto">Done</button>
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            <div className="kade-card">
              <div className="space-y-6 relative">
                {/* Decorations moved behind; keep form clean */}
                
                <label className="kade-label block text-black">
                  Describe Your Aesthetic Vision
                </label>
                <div className="kade-bubble">
                <textarea
                  placeholder="Share your design sensibilities: Perhaps bold artistic expressions with vibrant color contrasts, textured surfaces, experimental lighting, and avant-garde installations that speak to creative rebellion..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="kade-textarea w-full min-h-40"
                />
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={!isValidToGenerate}
                  className="kade-button kade-cta-pulse w-full text-base py-4"
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
              <div className="min-h-[300px] bg-[#e8e3db]/30 flex items-center justify-center relative p-4">
                {isGenerating && <div className="kade-drip-lines" />}
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
                ) : generatedImages.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                    {generatedImages.map((url, idx) => (
                      <div key={idx} className="relative kade-rough-edge">
                        <ImageWithFallback
                          src={url}
                          alt="AI Generated Space Design"
                          className="w-full h-full object-cover"
                          width={800}
                          height={600}
                        />
                        <a
                          href={url}
                          download
                          className="absolute bottom-2 right-2 bg-black text-white text-xs px-2 py-1"
                        >
                          Download
                        </a>
                        <div className="absolute -top-2 -left-2 w-10 h-3 kade-tape -rotate-6"></div>
                        <div className="absolute -bottom-2 -right-2 w-10 h-3 kade-tape rotate-6"></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center space-y-6 px-8">
                    <div className="w-28 h-28 mx-auto bg-muted rounded-sm flex items-center justify-center">
                      <Sparkles className="w-14 h-14 text-muted-foreground" />
                    </div>
                    <div className="space-y-3">
                      <div className="text-muted-foreground font-medium">Your curated design will appear here</div>
                      <div className="text-sm text-muted-foreground/70">Share your vision and select images to begin</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {generatedImages.length > 0 && (
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