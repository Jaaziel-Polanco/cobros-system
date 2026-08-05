import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import type { Ticket } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function BoletoPublicoPage(
    { params }: { params: Promise<{ token: string }> },
) {
    const { token } = await params

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data } = await supabase
        .from('tickets')
        .select('*')
        .eq('token_publico', token)
        .maybeSingle()

    if (!data) notFound()

    const ticket = data as Ticket
    const s = ticket.snapshot
    const anulado = ticket.estado === 'anulado'

    return (
        <main className="min-h-screen flex items-center justify-center p-6"
              style={{ background: 'linear-gradient(180deg,#0a1628,#091525)' }}>
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/70 p-8 text-center">
                <p className="text-sm font-semibold" style={{ color: '#007EC6' }}>
                    {s.negocio.nombre_comercial}
                </p>
                <h1 className="mt-6 text-xs uppercase tracking-[0.3em] text-slate-400">
                    Boleto de sorteo
                </h1>

                <p className={`mt-3 text-4xl font-bold tracking-widest ${anulado ? 'text-slate-600 line-through' : 'text-white'}`}>
                    {ticket.numero_formateado}
                </p>

                {anulado && (
                    <p className="mt-3 rounded-lg bg-red-500/20 px-3 py-2 text-sm font-semibold text-red-300">
                        Este boleto fue anulado
                    </p>
                )}

                <dl className="mt-8 space-y-2 text-left text-sm">
                    <div className="flex justify-between gap-4">
                        <dt className="text-slate-400">Cliente</dt>
                        <dd className="font-medium text-white">
                            {s.cliente.nombre} {s.cliente.apellido}
                        </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                        <dt className="text-slate-400">Emitido</dt>
                        <dd className="font-medium text-white">{s.emitido_at_rd}</dd>
                    </div>
                    {s.sorteo && (
                        <div className="flex justify-between gap-4">
                            <dt className="text-slate-400">Sorteo</dt>
                            <dd className="font-medium text-white">{s.sorteo.nombre}</dd>
                        </div>
                    )}
                </dl>

                {!anulado && (
                    <a
                        href={`/api/tickets/${token}/pdf`}
                        className="mt-8 inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-white"
                        style={{ background: 'linear-gradient(135deg,#007EC6,#0088d4)' }}
                    >
                        Descargar boleto en PDF
                    </a>
                )}

                {s.negocio.url_terminos && (
                    <a href={s.negocio.url_terminos}
                       className="mt-4 block text-xs text-slate-500 underline">
                        Términos y condiciones
                    </a>
                )}
            </div>
        </main>
    )
}
