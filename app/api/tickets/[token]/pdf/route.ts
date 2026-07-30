import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generarTicketPdf } from '@/lib/pdf/ticket-document'
import { permitir, ipDe } from '@/lib/api-publico/rate-limit'
import type { Ticket } from '@/lib/types'

// @react-pdf/renderer requiere el runtime de Node, no el de Edge.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Descarga pública del boleto. Se autentica por el token aleatorio de 256
 * bits del propio boleto, no por sesión: el cliente final no tiene cuenta.
 */
export async function GET(
    req: Request,
    { params }: { params: Promise<{ token: string }> },
) {
    const { token } = await params

    if (!token || token.length < 20) {
        return NextResponse.json({ error: 'Token inválido' }, { status: 400 })
    }

    // Generar un PDF cuesta CPU y esta ruta es pública
    if (!permitir(`pdf:${ipDe(req)}`, 30, 60_000)) {
        return NextResponse.json(
            { error: 'Demasiadas peticiones. Espera un momento.' },
            { status: 429, headers: { 'Retry-After': '60' } },
        )
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: ticket } = await supabase
        .from('tickets')
        .select('*')
        .eq('token_publico', token)
        .maybeSingle()

    if (!ticket) {
        return NextResponse.json({ error: 'Boleto no encontrado' }, { status: 404 })
    }

    if (ticket.estado === 'anulado') {
        return NextResponse.json({ error: 'Este boleto fue anulado' }, { status: 410 })
    }

    const pdf = await generarTicketPdf(ticket as Ticket)

    return new NextResponse(new Uint8Array(pdf), {
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition':
                `inline; filename="boleto-${ticket.numero_formateado}.pdf"`,
            'Cache-Control': 'private, max-age=300',
        },
    })
}
