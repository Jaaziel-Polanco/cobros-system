'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
    ArrowLeft, CalendarRange, Dices, Gift, Lock, Pencil, PlayCircle, Ticket, Trophy,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { activarSorteo, cerrarSorteo } from '@/lib/actions/sorteos'
import type { EjecucionConEjecutor, GanadorDetalle } from '@/lib/actions/sorteos'
import { SorteoFormDialog } from './sorteo-form-dialog'
import { EjecutarSorteoDialog } from './ejecutar-sorteo-dialog'
import { GanadoresPanel } from './ganadores-panel'
import { formatearFechaCalendario } from '@/lib/utils/fecha-rd'
import { ESTADO_SORTEO_LABELS } from '@/lib/types'
import type { Sorteo, EstadoSorteo } from '@/lib/types'

const ESTADO_COLORS: Record<EstadoSorteo, string> = {
    borrador: 'bg-slate-500/20 text-slate-300',
    activo: 'bg-green-500/20 text-green-300',
    cerrado: 'bg-red-500/20 text-red-300',
}

interface SorteoDetalleViewProps {
    sorteo: Sorteo
    totalBoletos: number
    ejecucionVigente: EjecucionConEjecutor | null
    ganadores: GanadorDetalle[]
    ejecuciones: EjecucionConEjecutor[]
    puedeGestionar: boolean
}

export function SorteoDetalleView({
    sorteo, totalBoletos, ejecucionVigente, ganadores, ejecuciones, puedeGestionar,
}: SorteoDetalleViewProps) {
    const [editar, setEditar] = useState(false)
    const [ejecutar, setEjecutar] = useState(false)
    /** Se incrementa en cada apertura del diálogo de ejecución: le sirve de
     *  `key` al formulario para que vuelva a montarse con los valores por
     *  defecto del sorteo. */
    const [sesionEjecutar, setSesionEjecutar] = useState(0)
    const [confirmarCierre, setConfirmarCierre] = useState(false)
    const [pendiente, startTransition] = useTransition()

    const cerrado = sorteo.estado === 'cerrado'
    const historial = ejecuciones.filter(e => !e.vigente)

    const activar = () => {
        startTransition(async () => {
            try {
                await activarSorteo(sorteo.id)
                toast.success('Sorteo activado. Los boletos nuevos irán a este sorteo.')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    const cerrar = () => {
        startTransition(async () => {
            try {
                await cerrarSorteo(sorteo.id)
                toast.success('Sorteo cerrado')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
            setConfirmarCierre(false)
        })
    }

    return (
        <div className="space-y-6">
            <Link
                href="/sorteos"
                className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white"
            >
                <ArrowLeft className="h-4 w-4" />Volver a sorteos
            </Link>

            {/* Cabecera */}
            <div className="rounded-2xl border border-white/5 bg-slate-800/50 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#007EC6]/10">
                            <Gift className="h-5 w-5 text-[#007EC6]" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="truncate text-xl font-bold text-white">{sorteo.nombre}</h1>
                                <span className={cn(
                                    'rounded-full px-2 py-0.5 text-xs font-medium',
                                    ESTADO_COLORS[sorteo.estado],
                                )}>
                                    {ESTADO_SORTEO_LABELS[sorteo.estado]}
                                </span>
                            </div>
                            {sorteo.descripcion && (
                                <p className="mt-1 text-sm text-slate-400">{sorteo.descripcion}</p>
                            )}
                        </div>
                    </div>

                    {puedeGestionar && (
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEditar(true)}
                                disabled={pendiente}
                                className="gap-2 border-white/10 text-slate-300 hover:bg-white/5"
                            >
                                <Pencil className="h-3.5 w-3.5" />Editar
                            </Button>
                            {sorteo.estado === 'borrador' && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={activar}
                                    disabled={pendiente}
                                    className="gap-2 border-green-500/30 text-green-300 hover:bg-green-500/10"
                                >
                                    <PlayCircle className="h-3.5 w-3.5" />Activar
                                </Button>
                            )}
                            {!cerrado && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setConfirmarCierre(true)}
                                    disabled={pendiente}
                                    className="gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10"
                                >
                                    <Lock className="h-3.5 w-3.5" />Cerrar
                                </Button>
                            )}
                            <Button
                                size="sm"
                                onClick={() => { setSesionEjecutar(n => n + 1); setEjecutar(true) }}
                                disabled={pendiente || cerrado}
                                title={cerrado ? 'Un sorteo cerrado no admite nuevas ejecuciones' : undefined}
                                className="gap-2 text-white disabled:opacity-40"
                                style={{ background: 'linear-gradient(135deg, #007EC6, #0096E8)' }}
                            >
                                <Dices className="h-3.5 w-3.5" />Ejecutar sorteo
                            </Button>
                        </div>
                    )}
                </div>

                <dl className="mt-5 grid gap-4 border-t border-white/5 pt-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                        <dt className="flex items-center gap-1.5 text-xs text-slate-500">
                            <Trophy className="h-3 w-3" />Premio
                        </dt>
                        <dd className="mt-0.5 text-sm text-slate-200">{sorteo.premio ?? '—'}</dd>
                    </div>
                    <div>
                        <dt className="flex items-center gap-1.5 text-xs text-slate-500">
                            <CalendarRange className="h-3 w-3" />Fechas
                        </dt>
                        <dd className="mt-0.5 text-sm text-slate-200">
                            {formatearFechaCalendario(sorteo.fecha_inicio)} – {formatearFechaCalendario(sorteo.fecha_fin)}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-xs text-slate-500">Prefijo</dt>
                        <dd className="mt-0.5 font-mono text-sm text-slate-200">{sorteo.prefijo}</dd>
                    </div>
                    <div>
                        <dt className="flex items-center gap-1.5 text-xs text-slate-500">
                            <Ticket className="h-3 w-3" />Boletos válidos
                        </dt>
                        <dd className="mt-0.5 text-sm text-slate-200">
                            {totalBoletos}
                            <span className="ml-1 text-xs text-slate-500">
                                (correlativo en {sorteo.ultimo_numero})
                            </span>
                        </dd>
                    </div>
                </dl>
            </div>

            {/* Un borrador CON ganadores vigentes no es un sorteo sin ejecutar.
                guardar_ejecucion_sorteo deja el sorteo en borrador cuando ya hay
                otro activo, y sin decirlo aquí la insignia "Borrador" mentiría
                sobre el estado real. */}
            {sorteo.estado === 'borrador' && ejecucionVigente && (
                <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                    Este sorteo ya tiene ganadores, pero sigue en <strong>borrador</strong>: no es el
                    sorteo que recibe los boletos nuevos. Solo puede haber un sorteo activo a la vez,
                    y al ejecutarlo ya había otro. Púlsale &quot;Activar&quot; si quieres que sea este.
                </p>
            )}

            {ejecucionVigente ? (
                <GanadoresPanel
                    ejecucion={ejecucionVigente}
                    ganadores={ganadores}
                    historial={historial}
                    puedeGestionar={puedeGestionar}
                />
            ) : (
                <div className="rounded-2xl border border-white/5 bg-slate-800/50 p-12 text-center">
                    <Trophy className="mx-auto h-8 w-8 text-slate-600" />
                    <p className="mt-3 text-sm text-slate-400">
                        Este sorteo todavía no tiene ganadores.
                        {puedeGestionar && !cerrado && ' Pulsa "Ejecutar sorteo" para seleccionarlos.'}
                    </p>
                </div>
            )}

            <SorteoFormDialog
                abierto={editar}
                onCerrar={() => setEditar(false)}
                sorteo={sorteo}
                prefijoBloqueado={sorteo.ultimo_numero > 0}
            />
            <EjecutarSorteoDialog
                abierto={ejecutar}
                onCerrar={() => setEjecutar(false)}
                sesion={sesionEjecutar}
                sorteo={sorteo}
                hayEjecucionPrevia={Boolean(ejecucionVigente)}
            />

            <AlertDialog open={confirmarCierre} onOpenChange={v => { if (!v) setConfirmarCierre(false) }}>
                <AlertDialogContent className="bg-slate-900 border-white/10 text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Cerrar el sorteo?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-400">
                            Un sorteo cerrado no admite más ejecuciones ni boletos nuevos, y no se
                            puede reactivar. Los ganadores ya seleccionados se conservan.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border-white/10 text-slate-300">Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={cerrar}
                            disabled={pendiente}
                            className="bg-red-600 text-white hover:bg-red-500"
                        >
                            Cerrar sorteo
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
