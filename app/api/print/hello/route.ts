import { NextResponse } from 'next/server'
import { autenticarEstacion, registrarLatido } from '@/lib/api-print/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
    const cuerpo = await req.json().catch(() => ({}))
    const estacion = await autenticarEstacion(cuerpo?.token)

    if (!estacion) {
        return NextResponse.json({ error: 'Token inválido' }, { status: 401 })
    }

    await registrarLatido(
        estacion.id,
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        typeof cuerpo?.version === 'string' ? cuerpo.version : null,
    )

    return NextResponse.json({
        estacion: estacion.nombre,
        sucursal: estacion.sucursal_nombre,
        impresora: { ip: estacion.impresora_ip, port: estacion.impresora_port },
        ancho_cols: estacion.ancho_cols,
        codepage: estacion.codepage,
    })
}
