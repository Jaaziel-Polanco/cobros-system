import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Phone, Mail, MapPin, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatMonto, formatFecha } from '@/lib/utils/template-renderer'
import { cn } from '@/lib/utils'

const ETAPA_CSS: Record<string, string> = {
    preventivo: 'bg-green-500/20 text-green-300',
    mora_temprana: 'bg-yellow-500/20 text-yellow-300',
    mora_alta: 'bg-orange-500/20 text-orange-300',
    recuperacion: 'bg-red-500/20 text-red-300',
    saldado: 'bg-slate-500/20 text-slate-400',
}
const ETAPA_LABELS: Record<string, string> = {
    preventivo: 'Preventivo',
    mora_temprana: 'Mora Temprana',
    mora_alta: 'Mora Alta',
    recuperacion: 'Recuperación',
    saldado: 'Saldado',
}
const ESTADO_CSS: Record<string, string> = {
    activo: 'bg-blue-500/20 text-blue-300',
    saldado: 'bg-green-500/20 text-green-300',
    cancelado: 'bg-slate-500/20 text-slate-400',
    refinanciado: 'bg-purple-500/20 text-purple-300',
}

export default async function ClienteDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const supabase = await createClient()

    const { data: cliente, error } = await supabase
        .from('clientes')
        .select(`
      *,
      agente:profiles(id, full_name),
      deudas(*, configuracion:configuracion_recordatorio(*)),
      referencias_cliente(*)
    `)
        .eq('id', id)
        .single()

    if (error || !cliente) notFound()

    // Historial de envíos del cliente
    const { data: logs } = await supabase
        .from('envios_log')
        .select('*')
        .eq('cliente_id', id)
        .order('sent_at', { ascending: false })
        .limit(20)

    const deudaActiva = cliente.deudas?.find((d: { estado: string }) => d.estado === 'activo')

    return (
        <div className="p-6 space-y-6 max-w-5xl">
            {/* Breadcrumb */}
            <Link href="/clientes" className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors">
                <ArrowLeft className="w-4 h-4" />
                Volver a Clientes
            </Link>

            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">{cliente.nombre} {cliente.apellido}</h1>
                    <p className="text-slate-400 text-sm mt-0.5">
                        {cliente.dni_ruc ? `Cédula/RNC: ${cliente.dni_ruc} ·` : ''} Agente: {(cliente as { agente?: { full_name: string } }).agente?.full_name ?? 'Sin asignar'}
                    </p>
                </div>
                {deudaActiva && (
                    <span className={cn('inline-flex px-3 py-1 rounded-full text-sm font-medium', ETAPA_CSS[deudaActiva.etapa])}>
                        {ETAPA_LABELS[deudaActiva.etapa]}
                    </span>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Info del cliente */}
                <div className="lg:col-span-1 space-y-4">
                    <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-5 space-y-3">
                        <h2 className="text-sm font-semibold text-white mb-4">Datos de contacto</h2>
                        <div className="flex items-center gap-3 text-sm text-slate-300">
                            <Phone className="w-4 h-4 text-indigo-400 shrink-0" />
                            {cliente.telefono}
                        </div>
                        {cliente.email && (
                            <div className="flex items-center gap-3 text-sm text-slate-300">
                                <Mail className="w-4 h-4 text-indigo-400 shrink-0" />
                                {cliente.email}
                            </div>
                        )}
                        {cliente.direccion && (
                            <div className="flex items-start gap-3 text-sm text-slate-300">
                                <MapPin className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                                {cliente.direccion}
                            </div>
                        )}
                        {cliente.notas && (
                            <div className="flex items-start gap-3 text-sm text-slate-300">
                                <FileText className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                                {cliente.notas}
                            </div>
                        )}
                    </div>

                    {/* Referencias */}
                    <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-5">
                        <h2 className="text-sm font-semibold text-white mb-4">Referencias ({cliente.referencias_cliente?.length ?? 0})</h2>
                        {!cliente.referencias_cliente?.length ? (
                            <p className="text-slate-600 text-xs">Sin referencias registradas</p>
                        ) : (
                            <div className="space-y-3">
                                {cliente.referencias_cliente.map((r: {
                                    id: string; nombre: string; telefono: string; relacion?: string; estado_contacto: string
                                }) => (
                                    <div key={r.id} className="border-t border-white/5 pt-3 first:border-0 first:pt-0">
                                        <p className="text-sm font-medium text-white">{r.nombre}</p>
                                        <p className="text-xs text-slate-400">{r.telefono} · {r.relacion ?? 'Referencia'}</p>
                                        <span className={cn('inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium mt-1',
                                            r.estado_contacto === 'contactado' ? 'bg-green-500/20 text-green-300' :
                                                r.estado_contacto === 'entregado' ? 'bg-blue-500/20 text-blue-300' :
                                                    r.estado_contacto === 'no_responde' ? 'bg-red-500/20 text-red-300' :
                                                        'bg-slate-500/20 text-slate-400'
                                        )}>
                                            {r.estado_contacto.replace('_', ' ')}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Deudas + Logs */}
                <div className="lg:col-span-2 space-y-4">
                    {/* Deudas */}
                    <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-5">
                        <h2 className="text-sm font-semibold text-white mb-4">Cuentas / Deudas ({cliente.deudas?.length ?? 0})</h2>
                        {!cliente.deudas?.length ? (
                            <p className="text-slate-600 text-xs">Sin deudas registradas</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-slate-500 text-xs border-b border-white/5">
                                            <th className="text-left pb-3 font-medium">Descripción</th>
                                            <th className="text-left pb-3 font-medium">Monto</th>
                                            <th className="text-left pb-3 font-medium">Saldo</th>
                                            <th className="text-left pb-3 font-medium">Vence</th>
                                            <th className="text-left pb-3 font-medium">Días</th>
                                            <th className="text-left pb-3 font-medium">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {cliente.deudas.map((d: {
                                            id: string; descripcion?: string; monto_original: number; saldo_pendiente: number;
                                            fecha_corte: string; dias_atraso: number; etapa: string; estado: string; es_deuda_existente: boolean
                                        }) => (
                                            <tr key={d.id} className="text-slate-300">
                                                <td className="py-3">
                                                    <div>{d.descripcion ?? 'Deuda'}</div>
                                                    {d.es_deuda_existente && (
                                                        <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">Existente</span>
                                                    )}
                                                </td>
                                                <td className="py-3 font-semibold text-white">{formatMonto(d.monto_original)}</td>
                                                <td className="py-3">{formatMonto(d.saldo_pendiente)}</td>
                                                <td className="py-3">{formatFecha(d.fecha_corte)}</td>
                                                <td className="py-3">
                                                    <span className={cn('font-semibold', d.dias_atraso > 0 ? 'text-red-400' : 'text-green-400')}>
                                                        {d.dias_atraso}d
                                                    </span>
                                                </td>
                                                <td className="py-3">
                                                    <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_CSS[d.estado] ?? '')}>
                                                        {d.estado}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Historial de envíos */}
                    <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-5">
                        <h2 className="text-sm font-semibold text-white mb-4">Historial de envíos (últimos 20)</h2>
                        {!logs?.length ? (
                            <p className="text-slate-600 text-xs">Sin envíos registrados</p>
                        ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                                {logs.map((log: {
                                    id: string; sent_at: string; etapa: string; estado: string; enviado_por: string; mensaje_enviado: string
                                }) => (
                                    <div key={log.id} className="flex items-start justify-between gap-3 border-b border-white/5 pb-2 last:border-0">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className={cn('inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium', ETAPA_CSS[log.etapa])}>
                                                    {ETAPA_LABELS[log.etapa] ?? log.etapa}
                                                </span>
                                                <span className="text-[10px] text-slate-500">{log.enviado_por}</span>
                                            </div>
                                            <p className="text-xs text-slate-400 truncate mt-1">{log.mensaje_enviado}</p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <div className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded',
                                                log.estado === 'enviado' ? 'bg-green-500/20 text-green-300' :
                                                    log.estado === 'error' ? 'bg-red-500/20 text-red-300' :
                                                        'bg-slate-500/20 text-slate-400'
                                            )}>
                                                {log.estado}
                                            </div>
                                            <div className="text-[10px] text-slate-600 mt-1">
                                                {new Date(log.sent_at).toLocaleDateString('es-DO')}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
