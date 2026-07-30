'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { emitirTicketManual, enviarTicketWhatsApp } from '@/lib/actions/tickets'

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

    const emitir = (enviar: boolean) => {
        if (motivo.trim().length < 3) {
            toast.error('El motivo debe tener al menos 3 caracteres')
            return
        }
        startTransition(async () => {
            try {
                const { ticket } = await emitirTicketManual({
                    cliente_id: clienteId,
                    motivo: motivo.trim(),
                })
                toast.success(`Boleto ${ticket.numero_formateado} generado`)

                if (enviar) {
                    await enviarTicketWhatsApp(ticket.id)
                    toast.success('Boleto enviado por WhatsApp')
                }

                setMotivo('')
                onCerrar()
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error al generar el boleto')
            }
        })
    }

    return (
        <Dialog open={abierto} onOpenChange={(v) => { if (!v) onCerrar() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Generar boleto manual</DialogTitle>
                    <DialogDescription>
                        Se emitirá un boleto adicional para {clienteNombre}, sin asociarlo a
                        ningún pago.
                    </DialogDescription>
                </DialogHeader>

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

                <div className="space-y-2">
                    <Button
                        className="w-full"
                        disabled={pendiente || !tieneTelefono}
                        onClick={() => emitir(true)}
                        style={{ background: 'linear-gradient(135deg,#25D366,#128C7E)' }}
                    >
                        Generar y enviar por WhatsApp
                    </Button>
                    <Button
                        variant="outline"
                        className="w-full"
                        disabled={pendiente}
                        onClick={() => emitir(false)}
                    >
                        Solo generar
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
