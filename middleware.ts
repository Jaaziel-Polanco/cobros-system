import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const PUBLIC_PATHS = ['/login']

/**
 * Rutas sin autenticación que, a diferencia de PUBLIC_PATHS, NO redirigen al
 * dashboard cuando ya hay sesión: un admin logueado debe poder abrir el
 * boleto de un cliente. `/api/print/*` se autentica por token de estación
 * dentro de su propio route handler.
 */
const OPEN_PATHS = ['/t/', '/terminos', '/api/tickets/', '/api/print/']

function verificarSecret(header: string | null): boolean {
    const expected = process.env.CRON_SECRET
    if (!expected || !header) return false
    if (header.length !== expected.length) return false
    let mismatch = 0
    for (let i = 0; i < header.length; i++) {
        mismatch |= header.charCodeAt(i) ^ expected.charCodeAt(i)
    }
    return mismatch === 0
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl

    if (OPEN_PATHS.some(p => pathname.startsWith(p))) {
        return NextResponse.next()
    }

    if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
        const { supabaseResponse, user } = await updateSession(request)
        if (user) {
            return NextResponse.redirect(new URL('/dashboard', request.url))
        }
        return supabaseResponse
    }

    // Rutas protegidas por CRON_SECRET (cron + simulate)
    if (pathname.startsWith('/api/cron') || pathname.startsWith('/api/simulate')) {
        // /api/simulate/secret usa auth por sesión, no CRON_SECRET
        if (pathname === '/api/simulate/secret') {
            const { supabaseResponse, user } = await updateSession(request)
            if (!user) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
            return supabaseResponse
        }

        if (!verificarSecret(request.headers.get('x-cron-secret'))) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        return NextResponse.next()
    }

    const { supabaseResponse, user } = await updateSession(request)

    if (!user) {
        const loginUrl = new URL('/login', request.url)
        loginUrl.searchParams.set('next', pathname)
        return NextResponse.redirect(loginUrl)
    }

    return supabaseResponse
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
