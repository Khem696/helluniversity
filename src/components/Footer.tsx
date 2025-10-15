'use client'

export function Footer() {
  return (
    <footer className="bg-neutral-900 text-white py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Brand Section */}
          <div className="space-y-4">
            <h3 className="text-2xl" style={{ fontWeight: '700' }}>HELL UNIVERSITY</h3>
            <p className="text-gray-300 text-sm">
              The place where Love, Fun & Joy come together. 
            </p>
            <div className="flex space-x-2" aria-label="Site values">
              <span className="bg-rose-500 px-3 py-1 rounded-full text-xs">Love</span>
              <span className="bg-orange-500 px-3 py-1 rounded-full text-xs">Fun</span>
              <span className="bg-yellow-500 px-3 py-1 rounded-full text-xs">Joy</span>
            </div>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            <h4 className="text-lg" style={{ fontWeight: '500' }}>Quick Links</h4>
            <ul className="space-y-2 text-sm text-gray-300">
              <li>
                <button 
                  onClick={() => document.getElementById('spaces')?.scrollIntoView({ behavior: 'smooth' })}
                  className="hover:text-white transition-colors"
                  aria-label="Jump to Spaces section"
                >
                  Spaces
                </button>
              </li>
              <li>
                <button 
                  onClick={() => document.getElementById('ai-generator')?.scrollIntoView({ behavior: 'smooth' })}
                  className="hover:text-white transition-colors"
                  aria-label="Jump to AI Generator section"
                >
                  AI Generator
                </button>
              </li>
              <li>
                <button 
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                  className="hover:text-white transition-colors"
                  aria-label="Back to top"
                >
                  Top
                </button>
              </li>
              <li>
                <button 
                  onClick={() => document.getElementById('reservation')?.scrollIntoView({ behavior: 'smooth' })}
                  className="hover:text-white transition-colors"
                  aria-label="Jump to Reservation section"
                >
                  Book Now
                </button>
              </li>
            </ul>
          </div>

          {/* Contact Info */}
          <div className="space-y-4">
            <h4 className="text-lg" style={{ fontWeight: '500' }}>Get in Touch</h4>
            <div className="space-y-2 text-sm text-gray-300">
              <p>📧 helluniversity.cm@gmail.com</p>
              <a href="https://www.facebook.com/kadejavanalikhikara" target="_blank" rel="noopener noreferrer">
                <p>
                  <span role="img" aria-label="Facebook" className="mr-1">📘</span>
                  Facebook: kadejavanalikhikara
                </p>
              </a>
              <a href="https://haisang.wixsite.com/kade-javanalikhikara" target="_blank" rel="noopener noreferrer">
                <p>
                  <span role="img" aria-label="Wix" className="mr-1">🌐</span>
                  Wix: kade-javanalikhikara
                </p>
              </a>
              {/* <p>📞 +66 088 088 0888</p>
              <p>📍 Mae Taeng, Chiang Mai</p> */}
              <p className="text-xs text-gray-400 mt-4">
                Intimate spaces • Curated experiences
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-800 mt-8 pt-8 text-center">
          <p className="text-sm text-gray-400">
            © 2025 HELL UNIVERSITY. All rights reserved. Crafted with ❤️ for intimate gatherings.
          </p>
        </div>
      </div>
    </footer>
  );
}