/**
 * NextAuth.js v5 Type Extensions
 * 
 * Extends NextAuth types to include custom properties:
 * - domain: User's email domain (extracted from email)
 */

import "next-auth"
import "next-auth/jwt"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      email: string
      name: string | null
      image: string | null
      domain: string
    }
  }

  interface User {
    id: string
    email: string
    name: string | null
    image: string | null
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string
    email?: string
    name?: string
    picture?: string
    domain?: string
  }
}

