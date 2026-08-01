import type { DestinoImpresora } from './tipos'
import type { RespuestaHello } from './api'

/**
 * Lo que el agente sabe de sí mismo mientras corre, para poder enseñarlo en
 * la interfaz local.
 *
 * Vive SOLO en memoria y a propósito: al reiniciar el agente se pierde. La
 * alternativa —una base de datos local, aunque fuera un archivo— añadiría
 * un archivo más que puede corromperse, llenarse o quedarse bloqueado en la
 * PC de una tienda, y a cambio no resolvería nada que el `agente.log` no
 * resuelva ya: el histórico de verdad está ahí y en la cola del servidor.
 * Esto es un panel de "qué está pasando ahora", no un registro.
 *
 * Nada de lo que hay aquí puede afectar al bucle de impresión: son
 * asignaciones a un objeto en memoria, sin E/S y sin await.
 */

/** Cuántos trabajos recientes se recuerdan. Suficiente para una jornada de
 *  mostrador sin que la página se vuelva ilegible ni la memoria crezca. */
export const MAX_ACTIVIDAD = 50

export type ResultadoActividad = 'impreso' | 'error' | 'descartado' | 'simulado'

export interface RegistroActividad {
    /** Id del trabajo en el servidor, o un id local para las pruebas. */
    id: string
    /** ISO. La página lo convierte a "hace 2 min" en el navegador. */
    at: string
    tipo: 'boleto' | 'prueba'
    resultado: ResultadoActividad
    /** Descripción corta y en llano: "Boleto (412 bytes)", "Página de prueba". */
    detalle: string
    /** A dónde se mandó: 'Windows «POS»' o 'red 10.0.0.5:9100'. */
    destino: string
    /** El error TAL CUAL lo devolvió Windows o la red. Sin reescribir. */
    error?: string
}

export interface InstantaneaEstado {
    iniciadoEn: string
    /** Última vez que el servidor contestó algo (hello o poll). */
    ultimoLatido: string | null
    ultimoFallo: { at: string; mensaje: string } | null
    estacion: string | null
    sucursal: string | null
    destino: DestinoImpresora | null
    anchoCols: number | null
    codepage: string | null
    actividad: RegistroActividad[]
}

const estado = {
    iniciadoEn: new Date().toISOString(),
    ultimoLatido: null as string | null,
    ultimoFallo: null as { at: string; mensaje: string } | null,
    saludo: null as RespuestaHello | null,
    destino: null as DestinoImpresora | null,
    actividad: [] as RegistroActividad[],
}

/** Texto corto del destino, el mismo que se enseña en la actividad y en el
 *  diagnóstico, para que no haya dos formas de nombrar la misma impresora. */
export function describirDestino(destino: DestinoImpresora | null): string {
    if (!destino) return 'destino desconocido'
    if (destino.tipo_conexion === 'windows') {
        return destino.nombre ? `Windows «${destino.nombre}»` : 'Windows (sin nombre de impresora)'
    }
    return destino.ip ? `red ${destino.ip}:${destino.port}` : 'red (sin IP)'
}

export function registrarSaludo(saludo: RespuestaHello): void {
    estado.saludo = saludo
    estado.destino = saludo.impresora
    marcarLatido()
}

/** El servidor contestó. Es el "latido" que se enseña en la interfaz: el
 *  mismo momento en el que el servidor marca la estación como conectada. */
export function marcarLatido(): void {
    estado.ultimoLatido = new Date().toISOString()
    estado.ultimoFallo = null
}

export function marcarFalloServidor(mensaje: string): void {
    estado.ultimoFallo = { at: new Date().toISOString(), mensaje }
}

/** El destino puede cambiar en caliente: el servidor lo manda en cada poll. */
export function registrarDestino(destino: DestinoImpresora): void {
    estado.destino = destino
}

export function registrarActividad(registro: RegistroActividad): void {
    estado.actividad.unshift(registro)
    if (estado.actividad.length > MAX_ACTIVIDAD) estado.actividad.length = MAX_ACTIVIDAD
}

export function destinoConocido(): DestinoImpresora | null {
    return estado.destino
}

export function instantanea(): InstantaneaEstado {
    return {
        iniciadoEn: estado.iniciadoEn,
        ultimoLatido: estado.ultimoLatido,
        ultimoFallo: estado.ultimoFallo,
        estacion: estado.saludo?.estacion ?? null,
        sucursal: estado.saludo?.sucursal ?? null,
        destino: estado.destino,
        anchoCols: estado.saludo?.ancho_cols ?? estado.destino?.ancho_cols ?? null,
        codepage: estado.saludo?.codepage ?? null,
        actividad: [...estado.actividad],
    }
}

/** Solo para las pruebas: deja el módulo como recién cargado. */
export function reiniciarEstado(): void {
    estado.iniciadoEn = new Date().toISOString()
    estado.ultimoLatido = null
    estado.ultimoFallo = null
    estado.saludo = null
    estado.destino = null
    estado.actividad = []
}
