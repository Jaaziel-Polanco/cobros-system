'use client'

import { useState, useTransition, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { marcarPagoPeriodo } from '@/lib/actions/deudas'
import { Deuda, FrecuenciaPago, FRECUENCIA_LABELS } from '@/lib/types'
import { formatMonto, formatFecha } from '@/lib/utils/template-renderer'
import { cn } from '@/lib/utils'
import {
    Bell, CheckCircle, ChevronDown, ChevronUp, Clock,
    AlertTriangle, X, Calendar,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ClienteSimple {
    id: string
    nombre: string
    apellido: string
    telefono: string
}

type DeudaPendiente = Deuda & {
    cliente?: ClienteSimple
    agente?: { full_name: string }
    ultimoPago: string | null
}

interface PagosPendientesPanelProps {
    deudasPendientes: DeudaPendiente[]
}

function getPeriodoActual(deuda: DeudaPendiente): string {
    const fc = new Date(deuda.fecha_corte + 'T00:00:00')
    if (deuda.frecuencia_pago === 'semanal') {
        const inicio = new Date(fc)
        inicio.setDate(inicio.getDate() - 7)
        return `${inicio.toISOString().split('T')[0]}/${deuda.fecha_corte}`
    }
    if (deuda.frecuencia_pago === 'quincenal') {
        const inicio = new Date(fc)
        inicio.setDate(inicio.getDate() - 15)
        return `${inicio.toISOString().split('T')[0]}/${deuda.fecha_corte}`
    }
    const inicio = new Date(fc)
    inicio.setMonth(inicio.getMonth() - 1)
    return `${inicio.toISOString().split('T')[0]}/${deuda.fecha_corte}`
}

function getUrgencia(deuda: DeudaPendiente): 'critico' | 'urgente' | 'proximo' {
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const fc = new Date(deuda.fecha_corte + 'T00:00:00')
    const dias = Math.floor((fc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))

    if (dias < 0) return 'critico'
    if (dias <= 1) return 'urgente'
    return 'proximo'
}

const URGENCIA_CONFIG = {
    critico: { color: '#ef4444', bgColor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.25)', label: 'Vencido', icon: AlertTriangle },
    urgente: { color: '#f59e0b', bgColor: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.25)', label: 'Hoy/Mañana', icon: Clock },
    proximo: { color: '#5bbfed', bgColor: 'rgba(0,126,198,0.1)', borderColor: 'rgba(0,126,198,0.2)', label: 'Próximo', icon: Calendar },
}

export function PagosPendientesPanel({ deudasPendientes }: PagosPendientesPanelProps) {
    const [expanded, setExpanded] = useState(false)
    const [isPending, startTransition] = useTransition()
    const [dismissed, setDismissed] = useState<Set<string>>(new Set())
    const [showAll, setShowAll] = useState(false)

    const pendientes = deudasPendientes.filter(d => !dismissed.has(d.id))
    const criticos = pendientes.filter(d => getUrgencia(d) === 'critico')
    const urgentes = pendientes.filter(d => getUrgencia(d) === 'urgente')
    const proximos = pendientes.filter(d => getUrgencia(d) === 'proximo')

    const total = pendientes.length
    const visible = showAll ? pendientes : pendientes.slice(0, 5)

    useEffect(() => {
        setExpanded(false)
    }, [total])

    const handleMarcarPagado = useCallback((deuda: DeudaPendiente) => {
        const periodo = getPeriodoActual(deuda)
        startTransition(async () => {
            try {
                await marcarPagoPeriodo(deuda.id, periodo)
                toast.success(`Pago registrado para ${deuda.cliente?.nombre ?? 'cliente'}`)
                setDismissed(prev => new Set([...prev, deuda.id]))
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error al registrar pago')
            }
        })
    }, [])

    if (total === 0) return null

    const accentColor = criticos.length > 0 ? '#ef4444' : urgentes.length > 0 ? '#f59e0b' : '#5bbfed'

    return (
        <div className="fixed bottom-5 right-5 z-50" style={{ maxWidth: expanded ? 380 : undefined }}>
            {/* Expanded list */}
            {expanded && (
                <div
                    className="mb-2 rounded-2xl overflow-hidden shadow-2xl"
                    style={{ background: '#0c1d38', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                    <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                        <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Pagos pendientes</p>
                        <button onClick={() => setExpanded(false)} className="text-slate-500 hover:text-white transition-colors">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="space-y-1 p-2 max-h-[60vh] overflow-y-auto">
                        {visible.sort((a, b) => {
                            const ua = getUrgencia(a)
                            const ub = getUrgencia(b)
                            const order = { critico: 0, urgente: 1, proximo: 2 }
                            return order[ua] - order[ub]
                        }).map(d => {
                            const urgencia = getUrgencia(d)
                            const config = URGENCIA_CONFIG[urgencia]
                            const UrgIcon = config.icon

                            return (
                                <div
                                    key={d.id}
                                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all duration-150"
                                    style={{ background: config.bgColor, border: `1px solid ${config.borderColor}` }}
                                >
                                    <UrgIcon className="w-3.5 h-3.5 shrink-0" style={{ color: config.color }} />

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <p className="text-xs text-white font-medium truncate">
                                                {d.cliente?.nombre} {d.cliente?.apellido}
                                            </p>
                                            <span className="text-[9px] px-1 py-0.5 rounded-full font-semibold shrink-0"
                                                style={{ background: `${config.color}20`, color: config.color }}>
                                                {config.label}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-slate-500 truncate">
                                            {FRECUENCIA_LABELS[d.frecuencia_pago as FrecuenciaPago] ?? 'Mensual'}
                                            {d.monto_original > 0 && d.cuota_mensual ? ` · ${formatMonto(d.cuota_mensual)}` : ''}
                                            {' · '}
                                            {formatFecha(d.fecha_corte)}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0">
                                        <Button
                                            size="sm"
                                            disabled={isPending}
                                            onClick={(e) => { e.stopPropagation(); handleMarcarPagado(d) }}
                                            className="h-6 px-2 text-[10px] font-semibold text-white gap-1"
                                            style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
                                        >
                                            <CheckCircle className="w-2.5 h-2.5" />
                                            Pagó
                                        </Button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setDismissed(prev => new Set([...prev, d.id])) }}
                                            className="text-slate-600 hover:text-slate-400 transition-colors p-0.5"
                                            title="Descartar"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            )
                        })}

                        {pendientes.length > 5 && (
                            <button
                                onClick={() => setShowAll(!showAll)}
                                className="w-full py-1.5 text-[10px] text-[#5bbfed] hover:text-white transition-colors font-medium"
                            >
                                {showAll ? 'Mostrar menos' : `Ver ${pendientes.length - 5} más...`}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Floating trigger button */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="ml-auto flex items-center gap-2.5 px-4 py-2.5 rounded-full shadow-lg transition-all duration-200 hover:scale-105"
                style={{
                    background: `linear-gradient(135deg, ${accentColor}20, ${accentColor}10)`,
                    border: `1px solid ${accentColor}40`,
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                }}
            >
                <div className="relative">
                    <Bell className="w-4.5 h-4.5" style={{ color: accentColor }} />
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-1">
                        {total > 99 ? '99+' : total}
                    </span>
                </div>
                <span className="text-xs font-semibold text-white">
                    {criticos.length > 0
                        ? `${criticos.length} vencido${criticos.length > 1 ? 's' : ''}`
                        : `${total} pendiente${total > 1 ? 's' : ''}`}
                </span>
                {criticos.length > 0 && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
            </button>
        </div>
    )
}
