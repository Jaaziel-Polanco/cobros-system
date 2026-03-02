import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /auth/callback
 *
 * Maneja el callback de Supabase para:
 * - Invitaciones (type=invite)
 * - Restablecimiento de contraseña (type=recovery)
 * - Confirmación de email (type=signup)
 *
 * Supabase redirige aquí con ?code=... (PKCE flow)
 * Este route intercambia el code por una sesión y redirige al siguiente paso.
 */
export async function GET(request: NextRequest) {
    const { searchParams, origin } = new URL(request.url)

    const code   = searchParams.get('code')
    const type   = searchParams.get('type')    // 'invite' | 'recovery' | 'signup' | null
    const next   = searchParams.get('next') ?? '/dashboard'
    const error  = searchParams.get('error')
    const errorDesc = searchParams.get('error_description')

    // Si Supabase envió error en el redirect
    if (error) {
        console.error('[auth/callback] Error de Supabase:', error, errorDesc)
        return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(errorDesc ?? error)}`)
    }

    // Intercambiar el code por una sesión (PKCE)
    if (code) {
        const supabase = await createClient()
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

        if (exchangeError) {
            console.error('[auth/callback] Error intercambiando código:', exchangeError.message)
            return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(exchangeError.message)}`)
        }

        // Para invitaciones y recuperación → ir a set-password
        if (type === 'invite' || type === 'recovery') {
            return NextResponse.redirect(`${origin}/set-password`)
        }

        // Para otros tipos → ir al next destino
        return NextResponse.redirect(`${origin}${next}`)
    }

    // Sin code — redirigir al login
    return NextResponse.redirect(`${origin}/login`)
}
