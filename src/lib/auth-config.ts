import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { logWarn } from "./logger"

/**
 * NextAuth.js v5 Configuration (2025)
 * 
 * Google Workspace OAuth authentication with domain restriction
 * 
 * This configuration is shared between:
 * - API route handler (app/api/auth/[...nextauth]/route.ts)
 * - Proxy middleware (proxy.ts)
 * 
 * Environment Variables:
 * - AUTH_SECRET: Secret for JWT encryption (generate with: openssl rand -base64 32)
 * - AUTH_URL: Base URL of your application
 * - GOOGLE_CLIENT_ID: Google OAuth Client ID
 * - GOOGLE_CLIENT_SECRET: Google OAuth Client Secret
 * - GOOGLE_WORKSPACE_DOMAIN: Your Google Workspace domain (e.g., huculturehub.com)
 */

export const { auth, handlers } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // Restrict to Google Workspace domain
          hd: process.env.GOOGLE_WORKSPACE_DOMAIN || undefined,
          prompt: "select_account",
          access_type: "offline",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // Additional domain check (backup security)
      const allowedDomain = process.env.GOOGLE_WORKSPACE_DOMAIN
      
      if (!allowedDomain) {
        // Fire-and-forget security warning
        logWarn("GOOGLE_WORKSPACE_DOMAIN not set - allowing all Google accounts", {}).catch(() => {})
        return true
      }

      // Check if user email matches allowed domain
      if (user.email) {
        const emailDomain = user.email.split("@")[1]
        if (emailDomain !== allowedDomain) {
          // Fire-and-forget security warning (redact part of email)
          const redactedEmail = user.email.replace(/(.{3}).*@/, '$1***@')
          logWarn("Sign-in rejected: unauthorized domain", { redactedEmail, expectedDomain: allowedDomain }).catch(() => {})
          return false
        }
      } else {
        // Fire-and-forget security warning
        logWarn("Sign-in rejected: No email in user profile", {}).catch(() => {})
        return false
      }

      return true
    },
    async redirect({ url, baseUrl }) {
      // Handle redirect after login
      // If callbackUrl is provided, use it; otherwise redirect to /admin
      if (url.startsWith("/")) {
        return `${baseUrl}${url}`
      }
      // If callbackUrl is a full URL, check if it's from the same origin
      if (url.startsWith(baseUrl)) {
        return url
      }
      // Default redirect to admin dashboard
      return `${baseUrl}/admin`
    },
    async jwt({ token, user, account, profile }) {
      // Add user info to token
      if (user) {
        token.id = user.id
        token.email = user.email
        // FIXED: Convert null to undefined for JWT token (JWT expects string | undefined, not string | null)
        token.name = user.name ?? undefined
        token.picture = user.image ?? undefined
        if (user.email) {
          token.domain = user.email.split("@")[1]
        }
      }
      return token
    },
    async session({ session, token }) {
      // Add user info to session
      if (session.user) {
        session.user.id = token.id as string
        session.user.email = token.email as string
        session.user.name = token.name as string
        session.user.image = token.picture as string
        session.user.domain = token.domain as string
      }
      return session
    },
  },
  pages: {
    signIn: "/admin/login",
    error: "/admin/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.AUTH_SECRET,
  trustHost: true, // Trust host for cookie handling
})

