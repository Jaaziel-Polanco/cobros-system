'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Printer, Search, Ban, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import {
    getBoletosDeSorteo, imprimirLoteDeSorteo, cancelarPendientesDeSorteo,
    type BoletoDelLote,
} from '@/lib/actions/impresion-lote'

/**
 * Cuántas filas se pintan a la vez.
 *
 * La lista que llega del servidor está COMPLETA a propósito (para que
 * «seleccionar todos» diga un número que sea verdad), pero pintar 1.300
 * filas de golpe deja la pantalla pegajosa en la PC de una tienda. Lo que
 * se limita es el DOM, nunca la selección: «seleccionar todos» marca los
 * que cumplen el filtro, se estén viendo o no.
 */
const FILAS_VISIBLES = 300

interface BoletosLotePanelProps {
    sorteoId: string
    totalBoletos: number
    /** `permisos.imprimir_ticket`: el mismo que exige `imprimirLoteDeSorteo`. */
    puedeImprimir: boolean
}

export function BoletosLotePanel({
    sorteoId, totalBoletos, puedeImprimir,
}: BoletosLotePanelProps) {
    const router = useRouter()
    const [abierto, setAbierto] = useState(false)
    const [boletos, setBoletos] = useState<BoletoDelLote[] | null>(null)
    const [cargando, setCargando] = useState(false)
    const [busqueda, setBusqueda] = useState('')
    const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
    const [confirmar, setConfirmar] = useState<'seleccion' | 'todos' | null>(null)
    const [confirmarCancelar, setConfirmarCancelar] = useState(false)
    const [motivoCancelar, setMotivoCancelar] = useState('')
    const [pendiente, startTransition] = useTransition()

    const cargar = async () => {
        setCargando(true)
        try {
            setBoletos(await getBoletosDeSorteo(sorteoId))
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : 'No se pudieron cargar los boletos')
        } finally {
            setCargando(false)
        }
    }

    const alternarPanel = () => {
        const siguiente = !abierto
        setAbierto(siguiente)
        if (siguiente && !boletos && !cargando) void cargar()
    }

    const filtrados = useMemo(() => {
        if (!boletos) return []
        const q = busqueda.trim().toLowerCase()
        if (!q) return boletos
        return boletos.filter(b =>
            b.numero_formateado.toLowerCase().includes(q)
            || b.cliente.toLowerCase().includes(q))
    }, [boletos, busqueda])

    /** Lo que de verdad se va a encolar de la selección actual. */
    const resumen = useMemo(() => {
        const elegidos = (boletos ?? []).filter(b => seleccion.has(b.id))
        const imprimibles = elegidos.filter(b => !b.anulado && !b.enCola)
        return {
            elegidos: elegidos.length,
            imprimibles: imprimibles.length,
            copias: imprimibles.filter(b => b.veces_impreso > 0).length,
            anulados: elegidos.filter(b => b.anulado).length,
            enCola: elegidos.filter(b => !b.anulado && b.enCola).length,
        }
    }, [boletos, seleccion])

    /** Lo mismo, pero para «todos». */
    const resumenTodos = useMemo(() => {
        const todos = boletos ?? []
        const imprimibles = todos.filter(b => !b.anulado && !b.enCola)
        return {
            imprimibles: imprimibles.length,
            copias: imprimibles.filter(b => b.veces_impreso > 0).length,
            anulados: todos.filter(b => b.anulado).length,
            enCola: todos.filter(b => !b.anulado && b.enCola).length,
        }
    }, [boletos])

    const pendientesEnCola = (boletos ?? []).filter(b => b.enCola).length

    const todosFiltradosMarcados = filtrados.length > 0
        && filtrados.every(b => seleccion.has(b.id))

    const alternarTodosFiltrados = () => {
        setSeleccion(prev => {
            const siguiente = new Set(prev)
            if (todosFiltradosMarcados) {
                for (const b of filtrados) siguiente.delete(b.id)
            } else {
                for (const b of filtrados) siguiente.add(b.id)
            }
            return siguiente
        })
    }

    const alternarUno = (id: string) => {
        setSeleccion(prev => {
            const siguiente = new Set(prev)
            if (siguiente.has(id)) siguiente.delete(id)
            else siguiente.add(id)
            return siguiente
        })
    }

    const imprimir = (modo: 'seleccion' | 'todos') => {
        setConfirmar(null)
        startTransition(async () => {
            try {
                const r = await imprimirLoteDeSorteo(
                    sorteoId,
                    modo === 'todos'
                        ? { modo: 'todos' }
                        : { modo: 'seleccion', ticketIds: [...seleccion] },
                )

                const partes = [`${r.encolados} boleto(s) en cola`]
                if (r.copias > 0) partes.push(`${r.copias} marcado(s) como COPIA`)
                if (r.yaEnCola > 0) partes.push(`${r.yaEnCola} ya estaban en cola`)
                if (r.omitidosAnulados > 0) partes.push(`${r.omitidosAnulados} anulado(s) omitido(s)`)

                if (r.errores.length > 0) {
                    // Un lote a medias no puede anunciarse como un éxito.
                    toast.error(`${partes.join(' · ')}. ${r.errores.length} fallaron.`, {
                        description: r.errores.slice(0, 3).join(' | '),
                    })
                } else {
                    toast.success(partes.join(' · '))
                }

                setSeleccion(new Set())
                await cargar()
                router.refresh()
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error al encolar el lote')
            }
        })
    }

    const cancelarPendientes = () => {
        const motivo = motivoCancelar.trim()
        if (motivo.length < 3) {
            toast.error('Escribe un motivo de al menos 3 caracteres')
            return
        }
        setConfirmarCancelar(false)
        startTransition(async () => {
            try {
                const { cancelados } = await cancelarPendientesDeSorteo(sorteoId, motivo)
                toast.success(`${cancelados} trabajo(s) pendiente(s) cancelado(s)`)
                setMotivoCancelar('')
                await cargar()
                router.refresh()
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error al cancelar')
            }
        })
    }

    return (
        <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-5">
            <button
                type="button"
                onClick={alternarPanel}
                className="flex w-full items-center justify-between gap-3 text-left"
                aria-expanded={abierto}
            >
                <span className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Printer className="h-4 w-4 text-[#007EC6]" />
                    Imprimir boletos
                    <span className="font-normal text-slate-500">
                        ({totalBoletos.toLocaleString('es-DO')})
                    </span>
                </span>
                {abierto
                    ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-500" />
                    : <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />}
            </button>

            {abierto && (
                <div className="mt-5 space-y-4">
                    {!puedeImprimir && (
                        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                            No tienes permiso para imprimir boletos. Puedes ver la lista,
                            pero no encolar impresiones.
                        </p>
                    )}

                    {cargando && (
                        <p className="flex items-center gap-2 py-6 text-sm text-slate-400">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Cargando los {totalBoletos.toLocaleString('es-DO')} boletos...
                        </p>
                    )}

                    {boletos && boletos.length === 0 && (
                        <p className="py-4 text-sm text-slate-500">
                            Este sorteo todavía no tiene boletos.
                        </p>
                    )}

                    {boletos && boletos.length > 0 && (
                        <>
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                                <Input
                                    value={busqueda}
                                    onChange={e => setBusqueda(e.target.value)}
                                    placeholder="Buscar por número o cliente"
                                    className="border-white/10 bg-slate-800 pl-9 text-white"
                                />
                            </div>

                            <div className="flex flex-wrap items-center gap-3 text-xs">
                                <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                                    <input
                                        type="checkbox"
                                        checked={todosFiltradosMarcados}
                                        onChange={alternarTodosFiltrados}
                                        className="h-4 w-4 accent-[#007EC6]"
                                    />
                                    Seleccionar {busqueda ? 'los filtrados' : 'todos'}
                                    {' '}({filtrados.length.toLocaleString('es-DO')})
                                </label>
                                {seleccion.size > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setSeleccion(new Set())}
                                        className="text-slate-500 underline underline-offset-2 hover:text-slate-300"
                                    >
                                        Limpiar selección
                                    </button>
                                )}
                                <span className="ml-auto text-slate-500">
                                    {seleccion.size.toLocaleString('es-DO')} seleccionado(s)
                                </span>
                            </div>

                            <div className="max-h-96 overflow-y-auto rounded-xl border border-white/5">
                                <table className="w-full text-left text-xs">
                                    <tbody>
                                        {filtrados.slice(0, FILAS_VISIBLES).map(b => (
                                            <tr
                                                key={b.id}
                                                className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]"
                                            >
                                                <td className="w-10 py-2 pl-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={seleccion.has(b.id)}
                                                        onChange={() => alternarUno(b.id)}
                                                        aria-label={`Seleccionar boleto ${b.numero_formateado}`}
                                                        className="h-4 w-4 accent-[#007EC6]"
                                                    />
                                                </td>
                                                <td className="py-2 pr-3 font-mono font-semibold text-white">
                                                    {b.numero_formateado}
                                                </td>
                                                <td className="py-2 pr-3 text-slate-400">{b.cliente}</td>
                                                <td className="py-2 pr-3 text-right">
                                                    <span className={cn(
                                                        'rounded px-1.5 py-0.5',
                                                        b.anulado && 'bg-red-500/20 text-red-300',
                                                        !b.anulado && b.enCola && 'bg-amber-500/20 text-amber-300',
                                                        !b.anulado && !b.enCola && b.veces_impreso > 0 && 'text-slate-500',
                                                    )}>
                                                        {b.anulado ? 'anulado'
                                                            : b.enCola ? 'en cola'
                                                                : b.veces_impreso > 0 ? 'saldrá como copia'
                                                                    : 'sin imprimir'}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {filtrados.length > FILAS_VISIBLES && (
                                <p className="text-xs text-slate-500">
                                    Se muestran {FILAS_VISIBLES} de {filtrados.length.toLocaleString('es-DO')}.
                                    Busca para acotar — <strong className="font-medium text-slate-400">
                                        «Seleccionar {busqueda ? 'los filtrados' : 'todos'}» marca
                                        los {filtrados.length.toLocaleString('es-DO')}</strong>, no solo
                                    los visibles.
                                </p>
                            )}

                            <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
                                <Button
                                    size="sm"
                                    disabled={!puedeImprimir || pendiente || resumen.imprimibles === 0}
                                    onClick={() => setConfirmar('seleccion')}
                                >
                                    {pendiente
                                        ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                        : <Printer className="mr-1.5 h-3.5 w-3.5" />}
                                    Imprimir seleccionados ({resumen.imprimibles.toLocaleString('es-DO')})
                                </Button>

                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={!puedeImprimir || pendiente || resumenTodos.imprimibles === 0}
                                    onClick={() => setConfirmar('todos')}
                                >
                                    Imprimir todos ({resumenTodos.imprimibles.toLocaleString('es-DO')})
                                </Button>

                                {pendientesEnCola > 0 && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={!puedeImprimir || pendiente}
                                        onClick={() => setConfirmarCancelar(true)}
                                        className="ml-auto border-red-500/30 text-red-300 hover:bg-red-500/10"
                                    >
                                        <Ban className="mr-1.5 h-3.5 w-3.5" />
                                        Cancelar pendientes ({pendientesEnCola.toLocaleString('es-DO')})
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}

            <AlertDialog open={confirmar !== null} onOpenChange={a => !a && setConfirmar(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            ¿Imprimir{' '}
                            {(confirmar === 'todos' ? resumenTodos.imprimibles : resumen.imprimibles)
                                .toLocaleString('es-DO')} boletos?
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2 text-sm">
                                <p>
                                    Se van a encolar en la impresora de tu sucursal. Saldrá un
                                    papel por boleto y <strong>eso no se puede deshacer</strong>.
                                </p>
                                {(() => {
                                    const r = confirmar === 'todos' ? resumenTodos : resumen
                                    return (
                                        <ul className="space-y-1 text-slate-400">
                                            {r.copias > 0 && (
                                                <li>
                                                    <strong className="text-amber-300">
                                                        {r.copias.toLocaleString('es-DO')} saldrán marcados
                                                        «***** COPIA *****»
                                                    </strong>{' '}
                                                    porque ya se imprimieron al emitirse.
                                                </li>
                                            )}
                                            {r.enCola > 0 && (
                                                <li>{r.enCola.toLocaleString('es-DO')} ya estaban en cola y se omiten.</li>
                                            )}
                                            {r.anulados > 0 && (
                                                <li>{r.anulados.toLocaleString('es-DO')} están anulados y se omiten.</li>
                                            )}
                                        </ul>
                                    )
                                })()}
                                <p className="text-xs text-slate-500">
                                    Si te equivocas: pausa el agente desde la página local de la
                                    caja (127.0.0.1:9110) y vuelve aquí a cancelar los pendientes.
                                </p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => confirmar && imprimir(confirmar)}>
                            Sí, imprimir
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={confirmarCancelar} onOpenChange={setConfirmarCancelar}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Cancelar los trabajos pendientes</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-3 text-sm">
                                <p>
                                    Solo se cancelan los que ningún agente ha tomado todavía. Los
                                    que ya está imprimiendo la caja van a salir igual: para
                                    detenerlos hay que pausar el agente en esa PC.
                                </p>
                                <Input
                                    value={motivoCancelar}
                                    onChange={e => setMotivoCancelar(e.target.value)}
                                    placeholder="Motivo (queda registrado)"
                                    className="border-white/10 bg-slate-800 text-white"
                                />
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Volver</AlertDialogCancel>
                        <AlertDialogAction onClick={cancelarPendientes}>
                            Cancelar pendientes
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
