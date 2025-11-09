import { redirect } from "next/navigation"
import { auth } from "@/lib/auth-config"
import { LoginButton } from "@/components/LoginButton"
import { SignOutMessage } from "@/components/SignOutMessage"
import Script from "next/script"
import Link from "next/link"

// Mark as dynamic to prevent static export issues
export const dynamic = 'force-dynamic'

/**
 * Admin Login Page
 * Simple login page with redirect if already authenticated
 */

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ signout?: string; error?: string }>
}) {
  // Await searchParams (Next.js 16 requires this)
  let params: { signout?: string; error?: string } = {}
  try {
    params = searchParams ? await searchParams : {}
  } catch (error) {
    console.warn("Login page: Failed to read searchParams:", error)
  }
  
  // Check if already authenticated
  let session = null
  try {
    session = await auth()
  } catch (error) {
    console.warn("Login page: auth() failed:", error)
    // Continue to show login form if auth check fails
  }
  
  // If user just signed out, always show login form (session might be clearing)
  // Only show "already logged in" if there's a valid session AND no signout param
  if (session?.user && !params?.signout) {
    return (
      <>
        <Script id="hide-header" strategy="beforeInteractive">
          {`
            (function() {
              const header = document.querySelector('header');
              if (header) {
                header.style.display = 'none';
                header.style.visibility = 'hidden';
              }
              document.documentElement.setAttribute('data-login-page', 'true');
            })();
          `}
        </Script>
        <div data-login-page className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
          <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-xl text-center">
            <div className="mb-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">You're Already Logged In</h2>
              <p className="text-gray-600 mb-2">
                Welcome back, {session.user.name || session.user.email}!
              </p>
            </div>
            <Link
              href="/admin"
              className="inline-block w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-center"
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Script id="hide-header" strategy="beforeInteractive">
        {`
          (function() {
            const header = document.querySelector('header');
            if (header) {
              header.style.display = 'none';
              header.style.visibility = 'hidden';
            }
            document.documentElement.setAttribute('data-login-page', 'true');
          })();
        `}
      </Script>
      <div data-login-page className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin Login</h1>
            <p className="text-gray-600">
              Sign in with your Google Workspace account
            </p>
            {process.env.GOOGLE_WORKSPACE_DOMAIN && (
              <p className="text-sm text-gray-500 mt-2">
                Only <span className="font-semibold">{process.env.GOOGLE_WORKSPACE_DOMAIN}</span> accounts are allowed
              </p>
            )}
            <SignOutMessage />
            {params?.error === "unauthorized" && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-800">
                  Access denied. Please sign in with an authorized account.
                </p>
              </div>
            )}
          </div>

          <LoginButton />

          <div className="mt-6 text-center">
            <p className="text-xs text-gray-500">
              By signing in, you agree to access the admin panel
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
