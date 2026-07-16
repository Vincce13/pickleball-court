import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const isLoginPage = req.nextUrl.pathname === '/admin/login'
  const session = req.cookies.get('admin_session')?.value

  const isAuthenticated = session === process.env.ADMIN_SESSION_SECRET

  if (!isLoginPage && !isAuthenticated) {
    return NextResponse.redirect(new URL('/admin/login', req.url))
  }

  if (isLoginPage && isAuthenticated) {
    return NextResponse.redirect(new URL('/admin', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/admin/:path*',
}