'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Plus, Download, Send, Ban, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TicketManualDialog } from './ticket-manual-dialog'
import {
    emitirTicketDePago, enviarTicketWhatsApp, anularTicket,
} from '@/lib/actions/tickets'
import { formatearFechaHoraRD } from '@/lib/utils/fecha-rd'
import { ESTADO_TICKET_COLORS, ESTADO_TICKET_LABELS, ORIGEN_TICKET_LABELS } from '@/lib/types'
import type { TicketConSorteoResumen } from '@/lib/types'

interface PagoSinBoleto {
    id: string
    monto: number
    periodo: string
    created_at: string
}

interface Props {
    clienteId: string
    clienteNombre: string
    tieneTelefono: boolean
    tickets: TicketConSorteoResumen[]
    pagosSinTicket: PagoSinBoleto[]
    /** Gatea "Boleto manual" y "Anular" (permiso `generar_ticket_manual`: crear o
     *  destruir boletos fuera del flujo normal de cobro). */
    puedeGenerar: boolean
    /** Gatea el aviso de "pagos sin boleto" y su botón "Emitir boleto" (permiso
     *  `ver_tickets`, NO `generar_ticket_manual`). Recuperar el boleto de un pago
     *  ya cobrado es parte del flujo normal de cobro, no "crear boletos de la
     *  nada": el servidor gatea emitirTicketDePago con ver_tickets a propósito.
     *  Si este bloque usara `puedeGenerar`, a un agente con ver_tickets pero sin
     *  generar_ticket_manual se le ocultaría el aviso y sus boletos pendientes
     *  se perderían en silencio. No lo colapses en un solo booleano. */
    puedeEmitirDePago: boolean
}

export function TicketsClientePanel({
    clienteId, clienteNombre, tieneTelefono, tickets, pagosSinTicket, puedeGenerar,
    puedeEmitirDePago,
}: Props) {
    const [manualAbierto, setManualAbierto] = useState(false)
    const [pendiente, startTransition] = useTransition()

    const emitirDePago = (pagoId: string) => {
        startTransition(async () => {
            try {
                const { ticket } = await emitirTicketDePago(pagoId)
                toast.success(`Boleto ${ticket.numero_formateado} generado`)
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    const reenviar = (ticketId: string) => {
        startTransition(async () => {
            try {
                await enviarTicketWhatsApp(ticketId, { reenvio: true })
                toast.success('Boleto reenviado')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    const anular = (ticketId: string) => {
        const motivo = window.prompt('Motivo de la anulación:')
        if (!motivo || motivo.trim().length < 3) return
        startTransition(async () => {
            try {
                await anularTicket(ticketId, motivo.trim())
                toast.success('Boleto anulado')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    return (
        <div className="rounded-2xl border border-white/5 bg-slate-800/50 p-5">
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">
                    Boletos ({tickets.length})
                </h2>
                {puedeGenerar && (
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        onClick={() => setManualAbierto(true)}
                    >
                        <Plus className="h-3 w-3" />
                        Boleto manual
                    </Button>
                )}
            </div>

            {pagosSinTicket.length > 0 && puedeEmitirDePago && (
                <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
                    <p className="flex items-center gap-2 text-xs font-medium text-amber-300">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {pagosSinTicket.length} pago{pagosSinTicket.length > 1 ? 's' : ''} sin boleto
                    </p>
                    <div className="mt-2 space-y-1">
                        {pagosSinTicket.map(p => (
                            <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                                <span className="text-slate-400">
                                    {formatearFechaHoraRD(p.created_at)} · período {p.periodo}
                                </span>
                                <Button
                                    size="sm"
                                    className="h-6 px-2 text-[10px]"
                                    disabled={pendiente}
                                    onClick={() => emitirDePago(p.id)}
                                >
                                    Emitir boleto
                                </Button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {tickets.length === 0 ? (
                <p className="text-xs text-slate-600">Sin boletos emitidos</p>
            ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {tickets.map(t => (
                        <div
                            key={t.id}
                            className="flex items-center justify-between gap-3 border-b border-white/5 pb-2 last:border-0"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-sm font-semibold text-white">
                                        {t.numero_formateado}
                                    </span>
                                    <span className={cn(
                                        'rounded px-1.5 py-0.5 text-[10px] font-medium',
                                        ESTADO_TICKET_COLORS[t.estado],
                                    )}>
                                        {ESTADO_TICKET_LABELS[t.estado]}
                                    </span>
                                    <span className="text-[10px] text-slate-500">
                                        {ORIGEN_TICKET_LABELS[t.origen]}
                                    </span>
                                </div>
                                <p className="mt-0.5 text-[11px] text-slate-500">
                                    {formatearFechaHoraRD(t.emitido_at)}
                                    {t.snapshot.sorteo ? ` · ${t.snapshot.sorteo.nombre}` : ' · sin sorteo'}
                                    {t.veces_enviado > 0 ? ` · enviado ${t.veces_enviado}×` : ''}
                                </p>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                                <a
                                    href={`/api/tickets/${t.token_publico}/pdf`}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="Descargar PDF"
                                    className="rounded p-1.5 text-slate-400 hover:bg-white/5 hover:text-white"
                                >
                                    <Download className="h-3.5 w-3.5" />
                                </a>
                                {t.estado === 'valido' && (
                                    <>
                                        <button
                                            title="Reenviar por WhatsApp"
                                            disabled={pendiente || !tieneTelefono}
                                            onClick={() => reenviar(t.id)}
                                            className="rounded p-1.5 text-slate-400 hover:bg-white/5 hover:text-green-400 disabled:opacity-30"
                                        >
                                            <Send className="h-3.5 w-3.5" />
                                        </button>
                                        {puedeGenerar && (
                                            <button
                                                title="Anular boleto"
                                                disabled={pendiente}
                                                onClick={() => anular(t.id)}
                                                className="rounded p-1.5 text-slate-400 hover:bg-white/5 hover:text-red-400 disabled:opacity-30"
                                            >
                                                <Ban className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <TicketManualDialog
                abierto={manualAbierto}
                onCerrar={() => setManualAbierto(false)}
                clienteId={clienteId}
                clienteNombre={clienteNombre}
                tieneTelefono={tieneTelefono}
            />
        </div>
    )
}
