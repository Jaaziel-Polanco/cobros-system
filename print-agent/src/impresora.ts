import { imprimirRed } from './impresora-red'
import { imprimirWindows } from './impresora-windows'
import { volcarASimulador } from './simulador-archivo'
import type { DestinoImpresora } from './tipos'

/**
 * Envía los bytes al destino correcto según `tipo_conexion`.
 *
 * El agente no decide el transporte por su cuenta: lo dice el servidor en
 * el `hello`/`poll` (ver el cambio de diseño de la Tarea 6). Aquí solo se
 * traduce ese dato a la función de bajo nivel que corresponde.
 *
 * Con `modoSimulador === 'archivo'` no se toca ni la red ni el spooler: los
 * bytes se vuelcan a un archivo y su interpretación se imprime en consola.
 * Es el modo que se usa para desarrollar sin impresora física.
 */
export function imprimir(
    destino: DestinoImpresora,
    bytes: Buffer,
    modoSimulador: '' | 'archivo' = '',
): Promise<void> {
    if (modoSimulador === 'archivo') {
        return volcarASimulador(destino, bytes)
    }

    if (destino.tipo_conexion === 'windows') {
        if (!destino.nombre) {
            return Promise.reject(new Error('La estación es de tipo "windows" pero no tiene impresora_nombre'))
        }
        return imprimirWindows(destino.nombre, bytes)
    }

    if (!destino.ip) {
        return Promise.reject(new Error('La estación es de tipo "red" pero no tiene impresora_ip'))
    }
    return imprimirRed(destino.ip, destino.port, bytes)
}
