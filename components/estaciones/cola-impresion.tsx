'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { cancelarTrabajoImpresion, reencolarTrabajoImpresion } from '@/lib/actions/impresion'
import type { PrintJobConDetalle } from '@/lib/actions/impresion'
import { ESTADO_PRINT_JOB_LABELS, ESTADO_PRINT_JOB_COLORS } from '@/lib/types'
import { formatearFechaHoraRD } from '@/lib/utils/fecha-rd'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Ban, ChevronDown, ChevronUp, RotateCw, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ColaImpresionProps {
    jobs: PrintJobConDetalle[]
}

/**
 * Cola de impresión de una sucursal, para administradores. Se renderiza
 * bajo la estación correspondiente en EstacionesView.
 *
 * Cancelar y reencolar son las dos únicas escrituras: ambas exclusivas de
 * admin (ver la nota de permisos en lib/actions/impresion.ts). Nada aquí
 * comprueba permisos de agente porque un agente nunca llega a ver este
 * componente — /estaciones ya redirige a quien no sea admin.
 */
export function ColaImpresion({ jobs }: ColaImpresionProps) {
    const [isPending, startTransition] = useTransition()
    const [expandidoId, setExpandidoId] = useState<string | null>(null)

    if (jobs.length === 0) {
        return (
            <p className="text-xs text-slate-500 pt-1">
                Sin trabajos de impresión recientes en esta sucursal.
            </p>
        )
    }

    const cancelar = (jobId: string) => {
        const motivo = window.prompt('Motivo de la cancelación:')
        if (!motivo || motivo.trim().length < 3) {
            if (motivo !== null) toast.error('Escribe un motivo de al menos 3 caracteres')
            return
        }
        startTransition(async () => {
            try {
                await cancelarTrabajoImpresion(jobId, motivo.trim())
                toast.success('Trabajo cancelado')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    const reencolar = (jobId: string) => {
        startTransition(async () => {
            try {
                await reencolarTrabajoImpresion(jobId)
                toast.success('Trabajo reencolado')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    return (
        <div className="space-y-2 pt-1">
            {jobs.map(job => {
                const puedeCancelar = job.estado === 'pendiente' || job.estado === 'reclamado'
                const puedeReencolar = job.estado === 'error'
                const expandido = expandidoId === job.id

                return (
                    <div key={job.id} className="rounded-xl border border-white/5 bg-slate-900/50 p-3 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className={cn('rounded px-1.5 py-0.5 font-medium', ESTADO_PRINT_JOB_COLORS[job.estado])}>
                                {ESTADO_PRINT_JOB_LABELS[job.estado]}
                            </span>
                            {job.es_prueba ? (
                                <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 font-medium text-indigo-300">
                                    Página de prueba
                                </span>
                            ) : (
                                <span className="font-mono font-semibold text-white">
                                    {job.ticket?.numero_formateado ?? 'Boleto eliminado'}
                                </span>
                            )}
                            {job.es_copia && <span className="text-slate-500">copia</span>}
                            <span className="text-slate-500">
                                encolado {formatearFechaHoraRD(job.created_at)}
                            </span>
                            <span className="text-slate-500">
                                {job.intentos}/{job.max_intentos} intentos
                            </span>
                            {job.estacion && (
                                <span className="text-slate-500">· {job.estacion.nombre}</span>
                            )}

                            <div className="ml-auto flex items-center gap-1.5">
                                {puedeReencolar && (
                                    <Button size="sm" variant="outline" disabled={isPending}
                                        className="h-6 gap-1 border-white/10 px-2 text-[11px] text-slate-300 hover:bg-white/5"
                                        onClick={() => reencolar(job.id)}>
                                        <RotateCw className="h-3 w-3" />Reencolar
                                    </Button>
                                )}
                                {puedeCancelar && (
                                    <Button size="sm" variant="outline" disabled={isPending}
                                        className="h-6 gap-1 border-red-500/30 px-2 text-[11px] text-red-400 hover:bg-red-500/10"
                                        onClick={() => cancelar(job.id)}>
                                        <XCircle className="h-3 w-3" />Cancelar
                                    </Button>
                                )}
                                {job.preview_texto && (
                                    <Button size="sm" variant="outline"
                                        className="h-6 gap-1 border-white/10 px-2 text-[11px] text-slate-300 hover:bg-white/5"
                                        onClick={() => setExpandidoId(expandido ? null : job.id)}>
                                        {expandido ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                        Vista previa
                                    </Button>
                                )}
                            </div>
                        </div>

                        {job.error_mensaje && (
                            // Cancelado es una decisión de un administrador; error es que algo
                            // se rompió (impresora, agente, estación desactivada). El motivo de
                            // cancelación se guarda en esta misma columna (no hay una separada),
                            // pero no deben leerse igual de un vistazo: un admin ojeando la lista
                            // no debe confundir una cancelación deliberada con un fallo real.
                            job.estado === 'cancelado' ? (
                                <p className="mt-1.5 flex items-center gap-1.5 text-slate-400">
                                    <Ban className="h-3 w-3 shrink-0" />
                                    {job.error_mensaje}
                                </p>
                            ) : (
                                <p className="mt-1.5 flex items-center gap-1.5 text-red-400">
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                    {job.error_mensaje}
                                </p>
                            )
                        )}

                        {expandido && job.preview_texto && (
                            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-2 font-mono text-[11px] text-slate-300">
                                {job.preview_texto}
                            </pre>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
