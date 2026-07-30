'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { emitirTicketManual, enviarTicketWhatsApp } from '@/lib/actions/tickets'
import type { Ticket } from '@/lib/types'

interface Props {
    abierto: boolean
    onCerrar: () => void
    clienteId: string
    clienteNombre: string
    tieneTelefono: boolean
}

export function TicketManualDialog({
    abierto, onCerrar, clienteId, clienteNombre, tieneTelefono,
}: Props) {
    const [motivo, setMotivo] = useState('')
    const [pendiente, startTransition] = useTransition()
    const [emitido, setEmitido] = useState<Ticket | null>(null)
    const [envioError, setEnvioError] = useState<string | null>(null)

    const cerrar = () => {
        setMotivo('')
        setEmitido(null)
        setEnvioError(null)
        onCerrar()
    }

    // Emisión y envío se separan igual que en TicketConfirmDialog: emitirTicketManual
    // NO es idempotente (no lleva pago_id, así que no hay índice único que lo proteja).
    // Si se reportara un solo error para ambos pasos, el agente reintentaría creyendo
    // que nada se generó y produciría un segundo boleto real, quemando otro número del
    // sorteo compartido por una única intención. Por eso, una vez que `emitido` tiene
    // valor, los botones de emisión quedan bloqueados sin excepción.
    const emitir = (enviar: boolean) => {
        if (motivo.trim().length < 3) {
            toast.error('El motivo debe tener al menos 3 caracteres')
            return
        }
        startTransition(async () => {
            let ticket: Ticket
            try {
                const res = await emitirTicketManual({
                    cliente_id: clienteId,
                    motivo: motivo.trim(),
                })
                ticket = res.ticket
                setEmitido(ticket)
                setEnvioError(null)
                toast.success(`Boleto ${ticket.numero_formateado} generado`)
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error al generar el boleto')
                return
            }

            if (enviar) {
                try {
                    await enviarTicketWhatsApp(ticket.id)
                    setEnvioError(null)
                    toast.success('Boleto enviado por WhatsApp')
                    cerrar()
                } catch (e: unknown) {
                    const motivoError = e instanceof Error ? e.message : 'Error desconocido'
                    setEnvioError(motivoError)
                    toast.error(
                        `Boleto ${ticket.numero_formateado} generado, pero no se pudo enviar por WhatsApp: ${motivoError}`,
                    )
                }
            }
        })
    }

    // Reintento de solo-envío: no vuelve a emitir, solo reintenta el webhook contra
    // el boleto que ya existe.
    const reintentarEnvio = () => {
        if (!emitido) return
        startTransition(async () => {
            try {
                await enviarTicketWhatsApp(emitido.id)
                setEnvioError(null)
                toast.success('Boleto enviado por WhatsApp')
                cerrar()
            } catch (e: unknown) {
                const motivoError = e instanceof Error ? e.message : 'Error desconocido'
                setEnvioError(motivoError)
                toast.error(`No se pudo enviar por WhatsApp: ${motivoError}`)
            }
        })
    }

    return (
        <Dialog open={abierto} onOpenChange={(v) => { if (!v) cerrar() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Generar boleto manual</DialogTitle>
                    <DialogDescription>
                        Se emitirá un boleto adicional para {clienteNombre}, sin asociarlo a
                        ningún pago.
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

                {emitido && envioError && (
                    <p className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-300">
                        El boleto <strong>{emitido.numero_formateado}</strong> se generó, pero no
                        se pudo enviar por WhatsApp: {envioError}
                    </p>
                )}

                {!emitido && (
                    <div className="space-y-2">
                        <Label htmlFor="motivo">Motivo (obligatorio)</Label>
                        <Input
                            id="motivo"
                            value={motivo}
                            onChange={e => setMotivo(e.target.value)}
                            placeholder="Ej: promoción de temporada"
                            maxLength={200}
                            disabled={pendiente}
                        />
                        <p className="text-[11px] text-slate-500">
                            Queda registrado en el historial del boleto.
                        </p>
                    </div>
                )}

                <div className="space-y-2">
                    <Button
                        className="w-full"
                        disabled={pendiente || !tieneTelefono || !!emitido}
                        onClick={() => emitir(true)}
                        style={{ background: 'linear-gradient(135deg,#25D366,#128C7E)' }}
                    >
                        Generar y enviar por WhatsApp
                    </Button>

                    {emitido && envioError && tieneTelefono && (
                        <Button
                            className="w-full"
                            disabled={pendiente}
                            onClick={reintentarEnvio}
                            style={{ background: 'linear-gradient(135deg,#25D366,#128C7E)' }}
                        >
                            Reintentar envío por WhatsApp
                        </Button>
                    )}

                    <Button
                        variant="outline"
                        className="w-full"
                        disabled={pendiente || !!emitido}
                        onClick={() => emitir(false)}
                    >
                        Solo generar
                    </Button>

                    {emitido && (
                        <a
                            href={`/api/tickets/${emitido.token_publico}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
                        >
                            <Download className="h-4 w-4" />
                            Descargar PDF
                        </a>
                    )}

                    {emitido && (
                        <Button
                            variant="ghost"
                            className="w-full text-slate-400"
                            disabled={pendiente}
                            onClick={cerrar}
                        >
                            Cerrar
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
