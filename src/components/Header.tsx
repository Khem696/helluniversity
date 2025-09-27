'use client'

import { Button } from "./ui/button"

export function Header() {
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    element?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#7ba3a3]/20 bg-[#faf8f5]/95 backdrop-blur supports-[backdrop-filter]:bg-[#faf8f5]/60">
      <div className="container flex h-20 items-center justify-between px-6 lg:px-8">
        <div className="flex items-center">
          <h1 className="hell-university-header">HELL UNIVERSITY</h1>
        </div>
        
        <nav className="hidden md:flex items-center space-x-6">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="text-sm font-medium tracking-wide text-[#6b655c] transition-colors hover:text-[#7ba3a3] uppercase"
          >
            Home
          </button>
          <button
            onClick={() => scrollToSection('spaces')}
            className="text-sm font-medium tracking-wide text-[#6b655c] transition-colors hover:text-[#7ba3a3] uppercase"
          >
            Spaces
          </button>
          <button
            onClick={() => scrollToSection('events')}
            className="text-sm font-medium tracking-wide text-[#6b655c] transition-colors hover:text-[#7ba3a3] uppercase"
          >
            Events
          </button>
          <button
            onClick={() => scrollToSection('workshops')}
            className="text-sm font-medium tracking-wide text-[#6b655c] transition-colors hover:text-[#7ba3a3] uppercase"
          >
            Workshops
          </button>
          <button
            onClick={() => scrollToSection('ai-generator')}
            className="text-sm font-medium tracking-wide text-[#6b655c] transition-colors hover:text-[#7ba3a3] uppercase"
          >
            AI Generator
          </button>
          <Button
            onClick={() => scrollToSection('reservation')}
            className="bg-[#7ba3a3] hover:bg-[#6b8b8b] text-[#faf8f5] font-medium tracking-wide px-6 rounded-full"
          >
            Reserve
          </Button>
        </nav>

        <Button
          onClick={() => scrollToSection('reservation')}
          className="md:hidden bg-[#7ba3a3] hover:bg-[#6b8b8b] text-[#faf8f5] rounded-full"
          size="sm"
        >
          Reserve
        </Button>
      </div>
    </header>
  );
}