import { createClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function TerminosPage() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: cfg } = await supabase
        .from('configuracion_ticket')
        .select('nombre_comercial, texto_legal, url_terminos')
        .eq('id', true)
        .maybeSingle()

    // Si hay una URL externa configurada, esa manda.
    if (cfg?.url_terminos) redirect(cfg.url_terminos)

    return (
        <main className="min-h-screen p-8" style={{ background: '#0a1628' }}>
            <div className="mx-auto max-w-2xl">
                <h1 className="text-xl font-bold text-white">
                    Términos y condiciones — {cfg?.nombre_comercial ?? 'Sorteo'}
                </h1>
                <p className="mt-6 whitespace-pre-line text-sm leading-relaxed text-slate-300">
                    {cfg?.texto_legal ?? 'No hay términos y condiciones configurados.'}
                </p>
            </div>
        </main>
    )
}
