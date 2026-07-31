/** Mismos valores que `TipoConexionEstacion` en el servidor (lib/types/tickets.ts). */
export type TipoConexion = 'red' | 'windows'

export interface DestinoImpresora {
    tipo_conexion: TipoConexion
    ip: string | null
    port: number
    nombre: string | null
    /**
     * Ancho del papel en columnas. Opcional a propósito: un agente nuevo
     * puede hablar con un servidor viejo que todavía no lo mande. Solo lo
     * usa el simulador para dibujar; imprimir de verdad no lo necesita,
     * porque los bytes llegan ya maquetados desde el servidor.
     */
    ancho_cols?: number
}

export interface TrabajoImpresion {
    id: string
    payload_escpos: string | null
    es_copia: boolean
}
