import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CreditCard, Users, AlertTriangle, CheckCircle, TrendingDown, Send, Clock, TrendingUp, Zap } from 'lucide-react'
import { formatMonto } from '@/lib/utils/template-renderer'

function hoyRD(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' })
}

async function getDashboardData() {
    const supabase = await createClient()

    const [deudas, enviosHoy] = await Promise.all([
        supabase
            .from('deudas')
            .select('etapa, estado, saldo_pendiente, monto_original, pausado')
            .eq('estado', 'activo'),
        supabase
            .from('envios_log')
            .select('id, estado')
            .gte('sent_at', hoyRD()),
    ])

    const activas = deudas.data?.filter(d => d.estado === 'activo') ?? []
    const totalCartera = activas.reduce((s, d) => s + Number(d.saldo_pendiente), 0)
    const byEtapa = {
        preventivo: activas.filter(d => d.etapa === 'preventivo').length,
        mora_temprana: activas.filter(d => d.etapa === 'mora_temprana').length,
        mora_alta: activas.filter(d => d.etapa === 'mora_alta').length,
        recuperacion: activas.filter(d => d.etapa === 'recuperacion').length,
    }

    const enviados = enviosHoy.data?.filter(e => e.estado === 'enviado').length ?? 0
    const erroresHoy = enviosHoy.data?.filter(e => e.estado === 'error').length ?? 0
    const totalEnviosHoy = enviosHoy.data?.length ?? 0

    return { totalCartera, activas: activas.length, byEtapa, enviados, erroresHoy, totalEnviosHoy }
}

async function getProximosVencimientos() {
    const supabase = await createClient()
    const en7dias = new Date()
    en7dias.setDate(en7dias.getDate() + 7)

    const { data } = await supabase
        .from('deudas')
        .select('id, fecha_corte, saldo_pendiente, etapa, cliente:clientes(nombre, apellido, telefono)')
        .eq('estado', 'activo')
        .lte('fecha_corte', en7dias.toISOString().split('T')[0])
        .gte('fecha_corte', new Date().toISOString().split('T')[0])
        .order('fecha_corte')
        .limit(10)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []) as any[]
}

export default async function DashboardPage() {
    const [stats, proximos] = await Promise.all([getDashboardData(), getProximosVencimientos()])

    const cards = [
        {
            label: 'Cartera Total',
            value: formatMonto(stats.totalCartera),
            icon: CreditCard,
            gradient: 'linear-gradient(135deg, #007EC6 0%, #0096E8 100%)',
            glow: 'rgba(0,126,198,0.35)',
            count: `${stats.activas} cuentas activas`,
            textColor: '#5bbfed',
            badge: '●',
        },
        {
            label: 'Mora Temprana',
            value: stats.byEtapa.mora_temprana,
            icon: AlertTriangle,
            gradient: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
            glow: 'rgba(245,158,11,0.3)',
            count: '1–15 días de atraso',
            textColor: '#fcd34d',
        },
        {
            label: 'Mora Alta',
            value: stats.byEtapa.mora_alta,
            icon: TrendingDown,
            gradient: 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)',
            glow: 'rgba(239,68,68,0.3)',
            count: '16–30 días de atraso',
            textColor: '#fca5a5',
        },
        {
            label: 'En Recuperación',
            value: stats.byEtapa.recuperacion,
            icon: AlertTriangle,
            gradient: 'linear-gradient(135deg, #9333ea 0%, #a855f7 100%)',
            glow: 'rgba(168,85,247,0.3)',
            count: '+30 días de atraso',
            textColor: '#d8b4fe',
        },
        {
            label: 'Preventivos',
            value: stats.byEtapa.preventivo,
            icon: CheckCircle,
            gradient: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
            glow: 'rgba(16,185,129,0.3)',
            count: 'Cuentas al día',
            textColor: '#6ee7b7',
        },
        {
            label: 'Enviados Hoy',
            value: stats.enviados,
            icon: Send,
            gradient: 'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)',
            glow: 'rgba(6,182,212,0.3)',
            count: stats.erroresHoy > 0 ? `${stats.erroresHoy} con error` : 'Sin errores',
            textColor: '#67e8f9',
        },
    ]

    const ETAPA_STYLES: Record<string, { bg: string; text: string; label: string }> = {
        preventivo: { bg: 'rgba(16,185,129,0.15)', text: '#6ee7b7', label: 'Preventivo' },
        mora_temprana: { bg: 'rgba(245,158,11,0.15)', text: '#fcd34d', label: 'Mora Temprana' },
        mora_alta: { bg: 'rgba(239,68,68,0.15)', text: '#fca5a5', label: 'Mora Alta' },
        recuperacion: { bg: 'rgba(168,85,247,0.15)', text: '#d8b4fe', label: 'Recuperación' },
    }

    return (
        <div className="p-4 sm:p-6 space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Dashboard</h1>
                    <p className="text-slate-400 text-sm mt-1">
                        Resumen de cartera · {new Date().toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                </div>
                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold"
                    style={{ background: 'rgba(0,126,198,0.1)', border: '1px solid rgba(0,126,198,0.2)', color: '#5bbfed' }}>
                    <Zap className="w-3.5 h-3.5" />
                    Sistema activo
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {cards.map((card, i) => (
                    <div
                        key={card.label}
                        className={`rounded-2xl p-4 sm:p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl ${i === 0 ? 'col-span-2 lg:col-span-1' : ''}`}
                        style={{
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.07)',
                        }}
                    >
                        <div className="flex items-start justify-between mb-3">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
                                style={{ background: card.gradient, boxShadow: `0 4px 12px ${card.glow}` }}>
                                <card.icon className="w-5 h-5 text-white" />
                            </div>
                            <TrendingUp className="w-4 h-4 text-slate-700" />
                        </div>
                        <p className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{card.value}</p>
                        <p className="text-xs sm:text-sm font-semibold text-slate-300 mt-1">{card.label}</p>
                        <p className="text-xs mt-1.5 font-medium" style={{ color: card.textColor }}>{card.count}</p>
                    </div>
                ))}
            </div>

            {/* Próximos vencimientos */}
            <div className="rounded-2xl overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ background: 'rgba(0,126,198,0.15)', border: '1px solid rgba(0,126,198,0.2)' }}>
                        <Clock className="w-4 h-4" style={{ color: '#007EC6' }} />
                    </div>
                    <h2 className="text-sm font-bold text-white">Próximos vencimientos</h2>
                    <span className="text-xs text-slate-500 ml-auto">próximos 7 días</span>
                </div>

                {proximos.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-12">No hay vencimientos próximos</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-slate-500 text-xs border-b border-white/5">
                                    <th className="text-left px-5 py-3 font-medium">Cliente</th>
                                    <th className="text-left px-5 py-3 font-medium hidden sm:table-cell">Teléfono</th>
                                    <th className="text-left px-5 py-3 font-medium">Vence</th>
                                    <th className="text-left px-5 py-3 font-medium">Saldo</th>
                                    <th className="text-left px-5 py-3 font-medium hidden md:table-cell">Etapa</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {(proximos as Array<{ id: string; fecha_corte: string; saldo_pendiente: number; etapa: string; cliente: { nombre: string; apellido: string; telefono: string } | null }>).map((d) => {
                                    const etapa = ETAPA_STYLES[d.etapa]
                                    return (
                                        <tr key={d.id} className="text-slate-300 hover:bg-white/2 transition-colors">
                                            <td className="px-5 py-3 font-medium text-white">
                                                {d.cliente ? `${d.cliente.nombre} ${d.cliente.apellido}` : '—'}
                                            </td>
                                            <td className="px-5 py-3 text-slate-400 hidden sm:table-cell">{d.cliente?.telefono ?? '—'}</td>
                                            <td className="px-5 py-3 text-slate-300">
                                                {new Date(d.fecha_corte + 'T00:00:00').toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })}
                                            </td>
                                            <td className="px-5 py-3 font-bold" style={{ color: '#5bbfed' }}>
                                                {formatMonto(d.saldo_pendiente)}
                                            </td>
                                            <td className="px-5 py-3 hidden md:table-cell">
                                                {etapa && (
                                                    <span className="inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold"
                                                        style={{ background: etapa.bg, color: etapa.text }}>
                                                        {etapa.label}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
