/** Mismos valores que `TipoConexionEstacion` en el servidor (lib/types/tickets.ts). */
export type TipoConexion = 'red' | 'windows'

export interface DestinoImpresora {
    tipo_conexion: TipoConexion
    ip: string | null
    port: number
    nombre: string | null
}

export interface TrabajoImpresion {
    id: string
    payload_escpos: string | null
    es_copia: boolean
}
