import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generarTicketPdf } from '@/lib/pdf/ticket-document'
import { permitir, permitirGlobal, ipDe } from '@/lib/api-publico/rate-limit'
import {
    CFG_TICKET_POR_DEFECTO, COLUMNAS_SORTEO_DEMO, TOKEN_DEMO,
    construirTicketDePrueba, elegirSorteoDemo,
} from '@/lib/tickets/boleto-demo'
import type { Ticket, ConfiguracionTicket } from '@/lib/types'

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

    // El boleto de ejemplo es el único token corto que vale: ver
    // lib/tickets/boleto-demo.ts. Va antes del tope de longitud, que existe
    // para descartar tanteos contra los tokens reales de 256 bits.
    const esEjemplo = token === TOKEN_DEMO

    if (!esEjemplo && (!token || token.length < 20)) {
        return NextResponse.json({ error: 'Token inválido' }, { status: 400 })
    }

    // Tope agregado PRIMERO: no depende de ninguna cabecera, así que es el
    // único freno que sobrevive a un X-Forwarded-For falsificado (ver
    // ipDe() en lib/api-publico/rate-limit.ts). El cupo por IP de abajo es
    // una cortesía adicional cuando sí hay un proxy de confianza delante.
    if (!permitirGlobal(120, 60_000)) {
        return NextResponse.json(
            { error: 'Demasiadas peticiones. Espera un momento.' },
            { status: 429, headers: { 'Retry-After': '60' } },
        )
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

    let ticket: Ticket

    if (esEjemplo) {
        const { data: cfg } = await supabase
            .from('configuracion_ticket').select('*').eq('id', true).maybeSingle()

        const { data: sorteos } = await supabase
            .from('sorteos')
            .select(COLUMNAS_SORTEO_DEMO)
            .in('estado', ['activo', 'borrador'])
            .order('created_at', { ascending: false })
            .limit(50)

        ticket = construirTicketDePrueba(
            (cfg as ConfiguracionTicket | null) ?? CFG_TICKET_POR_DEFECTO,
            elegirSorteoDemo(sorteos),
        )
    } else {
        const { data } = await supabase
            .from('tickets')
            .select('*')
            .eq('token_publico', token)
            .maybeSingle()

        if (!data) {
            return NextResponse.json({ error: 'Boleto no encontrado' }, { status: 404 })
        }

        if (data.estado === 'anulado') {
            return NextResponse.json({ error: 'Este boleto fue anulado' }, { status: 410 })
        }

        ticket = data as Ticket
    }

    const pdf = await generarTicketPdf(ticket)

    return new NextResponse(new Uint8Array(pdf), {
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition':
                `inline; filename="boleto-${ticket.numero_formateado}.pdf"`,
            'Cache-Control': 'private, max-age=300',
        },
    })
}
