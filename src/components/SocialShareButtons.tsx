"use client"

import { Facebook, Twitter, Linkedin, Share2, Copy, Check } from "lucide-react"
import { useState } from "react"
import { trackInternalLinkClick } from "@/lib/analytics"

interface SocialShareButtonsProps {
  url: string
  title: string
  description?: string
  className?: string
  variant?: "default" | "compact"
}

export function SocialShareButtons({ 
  url, 
  title, 
  description = "",
  className = "",
  variant = "default"
}: SocialShareButtonsProps) {
  const [copied, setCopied] = useState(false)
  
  // Ensure URL is absolute
  const absoluteUrl = url.startsWith('http') ? url : `${typeof window !== 'undefined' ? window.location.origin : ''}${url}`
  const shareText = description ? `${title} - ${description}` : title
  const encodedUrl = encodeURIComponent(absoluteUrl)
  const encodedTitle = encodeURIComponent(title)
  const encodedText = encodeURIComponent(shareText)

  const shareLinks = {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    twitter: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}&via=huculturehub`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
  }

  const handleShare = async (platform: string) => {
    // Track social share
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'share', {
        method: platform,
        content_type: 'page',
        item_id: url,
      })
    }

    if (platform === 'native' && typeof navigator !== 'undefined' && 'share' in navigator && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title,
          text: description,
          url: absoluteUrl,
        })
      } catch (err) {
        // User cancelled or error occurred
        console.log('Share cancelled or failed')
      }
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      
      // Track copy action
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'share', {
          method: 'copy_link',
          content_type: 'page',
          item_id: url,
        })
      }
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  if (variant === "compact") {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <a
          href={shareLinks.facebook}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => handleShare('facebook')}
          className="text-gray-600 hover:text-[#1877F2] transition-colors"
          aria-label="Share on Facebook"
        >
          <Facebook className="w-5 h-5" />
        </a>
        <a
          href={shareLinks.twitter}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => handleShare('twitter')}
          className="text-gray-600 hover:text-[#1DA1F2] transition-colors"
          aria-label="Share on Twitter"
        >
          <Twitter className="w-5 h-5" />
        </a>
        <a
          href={shareLinks.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => handleShare('linkedin')}
          className="text-gray-600 hover:text-[#0077B5] transition-colors"
          aria-label="Share on LinkedIn"
        >
          <Linkedin className="w-5 h-5" />
        </a>
        {typeof navigator !== 'undefined' && 'share' in navigator && typeof navigator.share === 'function' && (
          <button
            onClick={() => handleShare('native')}
            className="text-gray-600 hover:text-gray-900 transition-colors"
            aria-label="Share via native share"
          >
            <Share2 className="w-5 h-5" />
          </button>
        )}
        <button
          onClick={handleCopy}
          className="text-gray-600 hover:text-gray-900 transition-colors"
          aria-label="Copy link"
        >
          {copied ? <Check className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5" />}
        </button>
      </div>
    )
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <span className="text-sm text-gray-600 font-comfortaa">Share:</span>
      <a
        href={shareLinks.facebook}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => handleShare('facebook')}
        className="inline-flex items-center gap-2 px-4 py-2 bg-[#1877F2] text-white rounded-lg hover:bg-[#166FE5] transition-colors font-comfortaa text-sm"
        aria-label="Share on Facebook"
      >
        <Facebook className="w-4 h-4" />
        Facebook
      </a>
      <a
        href={shareLinks.twitter}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => handleShare('twitter')}
        className="inline-flex items-center gap-2 px-4 py-2 bg-[#1DA1F2] text-white rounded-lg hover:bg-[#1A91DA] transition-colors font-comfortaa text-sm"
        aria-label="Share on Twitter"
      >
        <Twitter className="w-4 h-4" />
        Twitter
      </a>
      <a
        href={shareLinks.linkedin}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => handleShare('linkedin')}
        className="inline-flex items-center gap-2 px-4 py-2 bg-[#0077B5] text-white rounded-lg hover:bg-[#006399] transition-colors font-comfortaa text-sm"
        aria-label="Share on LinkedIn"
      >
        <Linkedin className="w-4 h-4" />
        LinkedIn
      </a>
      {typeof navigator !== 'undefined' && 'share' in navigator && typeof navigator.share === 'function' && (
        <button
          onClick={() => handleShare('native')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-comfortaa text-sm"
          aria-label="Share via native share"
        >
          <Share2 className="w-4 h-4" />
          More
        </button>
      )}
      <button
        onClick={handleCopy}
        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-comfortaa text-sm"
        aria-label="Copy link"
      >
        {copied ? (
          <>
            <Check className="w-4 h-4 text-green-600" />
            Copied!
          </>
        ) : (
          <>
            <Copy className="w-4 h-4" />
            Copy Link
          </>
        )}
      </button>
    </div>
  )
}

