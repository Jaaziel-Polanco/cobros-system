'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Ticket as TicketIcon, MessageCircle, Printer, Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { emitirTicketDePago, enviarTicketWhatsApp } from '@/lib/actions/tickets'
import type { Ticket } from '@/lib/types'

interface Props {
    abierto: boolean
    onCerrar: () => void
    pagoId: string | null
    clienteNombre: string
    clienteTelefono: string | null
    puedeImprimir?: boolean
}

function telefonoValido(t: string | null): boolean {
    return !!t && t.replace(/\D/g, '').length >= 10
}

export function TicketConfirmDialog({
    abierto, onCerrar, pagoId, clienteNombre, clienteTelefono, puedeImprimir = false,
}: Props) {
    const [pendiente, startTransition] = useTransition()
    const [emitido, setEmitido] = useState<Ticket | null>(null)
    const [envioError, setEnvioError] = useState<string | null>(null)

    const hayTelefono = telefonoValido(clienteTelefono)

    const cerrar = () => {
        setEmitido(null)
        setEnvioError(null)
        onCerrar()
    }

    // Emisión y envío son dos fallos distintos: el boleto puede haberse
    // generado con éxito aunque el webhook de WhatsApp falle (n8n caído,
    // sin plantilla activa, etc.). Reportar ambos bajo el mismo mensaje
    // ("Error al generar el boleto") es falso cuando lo único que falló fue
    // el envío, y además el pago ya está comprometido antes de abrir este
    // modal: el agente necesita el número del boleto de todos modos.
    const emitir = (enviar: boolean) => {
        if (!pagoId) return
        startTransition(async () => {
            let ticket: Ticket
            try {
                const res = await emitirTicketDePago(pagoId)
                ticket = res.ticket
                setEmitido(ticket)
                setEnvioError(null)

                toast.success(
                    res.yaExistia
                        ? `Este pago ya tenía el boleto ${ticket.numero_formateado}`
                        : `Boleto ${ticket.numero_formateado} generado`,
                )
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'No se pudo generar el boleto')
                return
            }

            if (enviar) {
                try {
                    await enviarTicketWhatsApp(ticket.id)
                    setEnvioError(null)
                    toast.success('Boleto enviado por WhatsApp')
                    cerrar()
                } catch (e: unknown) {
                    const motivo = e instanceof Error ? e.message : 'Error desconocido'
                    setEnvioError(motivo)
                    toast.error(
                        `Boleto ${ticket.numero_formateado} generado, pero no se pudo enviar por WhatsApp: ${motivo}`,
                    )
                }
            }
        })
    }

    // Reintento de solo-envío: no vuelve a emitir (emitirTicketDePago ya es
    // idempotente, pero no hace falta ni tocarlo) — solo reintenta el
    // webhook contra el boleto que ya existe.
    const reintentarEnvio = () => {
        if (!emitido) return
        startTransition(async () => {
            try {
                await enviarTicketWhatsApp(emitido.id)
                setEnvioError(null)
                toast.success('Boleto enviado por WhatsApp')
                cerrar()
            } catch (e: unknown) {
                const motivo = e instanceof Error ? e.message : 'Error desconocido'
                setEnvioError(motivo)
                toast.error(`No se pudo enviar por WhatsApp: ${motivo}`)
            }
        })
    }

    return (
        <Dialog open={abierto} onOpenChange={(v) => { if (!v) cerrar() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <TicketIcon className="h-5 w-5 text-[#007EC6]" />
                        Pago registrado
                    </DialogTitle>
                    <DialogDescription>
                        ¿Generar el boleto de sorteo para <strong>{clienteNombre}</strong>?
                    </DialogDescription>
                </DialogHeader>

                {emitido && (
                    <div className="rounded-xl border border-white/10 bg-slate-800/50 p-4 text-center">
                        <p className="text-xs uppercase tracking-widest text-slate-400">
                            Boleto generado
                        </p>
                        <p className="mt-1 text-2xl font-bold tracking-wider text-white">
                            {emitido.numero_formateado}
                        </p>
                    </div>
                )}

                {!hayTelefono && (
                    <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-300">
                        Este cliente no tiene un teléfono válido registrado, así que no se
                        puede enviar por WhatsApp. Puedes imprimirlo o descargarlo.
                    </p>
                )}

                {emitido && envioError && (
                    <p className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-300">
                        El boleto <strong>{emitido.numero_formateado}</strong> se generó, pero no
                        se pudo enviar por WhatsApp: {envioError}
                    </p>
                )}

                <div className="space-y-2">
                    <Button
                        className="w-full justify-start gap-2"
                        disabled={pendiente || !hayTelefono || !!emitido}
                        onClick={() => emitir(true)}
                        style={{ background: 'linear-gradient(135deg,#25D366,#128C7E)' }}
                    >
                        <MessageCircle className="h-4 w-4" />
                        Generar y enviar por WhatsApp
                    </Button>

                    {emitido && envioError && hayTelefono && (
                        <Button
                            className="w-full justify-start gap-2"
                            disabled={pendiente}
                            onClick={reintentarEnvio}
                            style={{ background: 'linear-gradient(135deg,#25D366,#128C7E)' }}
                        >
                            <MessageCircle className="h-4 w-4" />
                            Reintentar envío por WhatsApp
                        </Button>
                    )}

                    <Button
                        variant="outline"
                        className="w-full justify-start gap-2"
                        disabled
                        title={puedeImprimir ? undefined : 'Disponible al instalar la impresora'}
                    >
                        <Printer className="h-4 w-4" />
                        Generar e imprimir
                        <span className="ml-auto text-[10px] text-slate-500">Próximamente</span>
                    </Button>

                    <Button
                        variant="outline"
                        className="w-full justify-start gap-2"
                        disabled={pendiente || !!emitido}
                        onClick={() => emitir(false)}
                    >
                        <TicketIcon className="h-4 w-4" />
                        Solo generar
                    </Button>

                    {emitido && (
                        <a
                            href={`/api/tickets/${emitido.token_publico}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex w-full items-center gap-2 rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
                        >
                            <Download className="h-4 w-4" />
                            Descargar PDF
                        </a>
                    )}

                    <Button
                        variant="ghost"
                        className="w-full justify-start gap-2 text-slate-400"
                        disabled={pendiente}
                        onClick={cerrar}
                    >
                        <X className="h-4 w-4" />
                        {emitido ? 'Cerrar' : 'No generar'}
                    </Button>
                </div>

                {!emitido && (
                    <p className="text-[11px] text-slate-500">
                        Si cierras sin generar, podrás emitir el boleto después desde el
                        perfil del cliente.
                    </p>
                )}
            </DialogContent>
        </Dialog>
    )
}
