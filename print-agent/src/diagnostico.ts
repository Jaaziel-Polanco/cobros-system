import net from 'node:net'
import { ClienteApi, ErrorHttp } from './api'
import { listarImpresorasWindows } from './impresora-windows'
import { describirDestino, destinoConocido, registrarSaludo } from './estado'
import type { Config } from './config'
import type { DestinoImpresora } from './tipos'

/**
 * Las comprobaciones que contestan «¿está todo bien?» desde la PC de la
 * tienda, en el orden en que fallan las cosas de verdad: primero se llega o
 * no al servidor, después el servidor acepta o no este token, después
 * existe o no la impresora que ese servidor manda usar.
 *
 * Cada punto lleva SIEMPRE un `queHacer`. Un diagnóstico que dice "error"
 * sin decir qué tocar no sirve en un mostrador: quien lo lee no está
 * depurando el sistema, está intentando cobrar.
 *
 * Todo esto se ejecuta a petición de la interfaz, nunca en el bucle de
 * impresión, y no comparte estado con él salvo para APUNTAR lo que
 * descubre (un `hello` que sale bien también es un latido válido).
 */

export type NivelPunto = 'ok' | 'error' | 'aviso' | 'desconocido'

export interface PuntoDiagnostico {
    clave: 'servidor' | 'token' | 'impresora'
    titulo: string
    nivel: NivelPunto
    /** Una línea: qué pasa. */
    resumen: string
    /** Qué hacer al respecto. Siempre presente, también cuando va bien. */
    queHacer: string
    /** Lista auxiliar (hoy: las impresoras que sí existen en este PC). */
    lista?: string[]
    tituloLista?: string
}

export interface ResultadoDiagnostico {
    at: string
    puntos: PuntoDiagnostico[]
}

/** Intenta abrir un socket y cerrarlo. No manda ni un byte a la impresora. */
export function probarConexionTcp(
    ip: string,
    puerto: number,
    timeoutMs = 5_000,
): Promise<{ ok: true } | { ok: false; error: string }> {
    return new Promise(resolver => {
        let terminado = false
        const acabar = (r: { ok: true } | { ok: false; error: string }) => {
            if (terminado) return
            terminado = true
            socket.destroy()
            resolver(r)
        }

        const socket = net.createConnection({ host: ip, port: puerto, timeout: timeoutMs })
        socket.on('connect', () => acabar({ ok: true }))
        socket.on('timeout', () => acabar({
            ok: false,
            error: `no contestó en ${timeoutMs / 1000} s`,
        }))
        socket.on('error', (err: NodeJS.ErrnoException) => acabar({
            ok: false,
            error: `${err.code ?? ''} ${err.message}`.trim(),
        }))
    })
}

/**
 * Servidor y token en una sola petición.
 *
 * Son dos preguntas distintas pero la respuesta a las dos está en el mismo
 * `hello`: si la petición ni sale, es la red o `API_URL`; si sale y vuelve
 * un 401, la red está bien y lo que sobra es el token; si vuelve 200, el
 * cuerpo dice a qué estación y sucursal pertenece este token, que es la
 * única forma de darse cuenta de que se instaló el token de la otra tienda.
 */
async function comprobarServidorYToken(cfg: Config): Promise<{
    servidor: PuntoDiagnostico
    token: PuntoDiagnostico
    destino: DestinoImpresora | null
}> {
    const api = new ClienteApi(cfg.apiUrl, cfg.token, cfg.pollEsperaMs)

    try {
        const saludo = await api.hello()
        registrarSaludo(saludo)

        return {
            destino: saludo.impresora,
            servidor: {
                clave: 'servidor',
                titulo: 'Servidor de cobros',
                nivel: 'ok',
                resumen: `Se llega bien a ${cfg.apiUrl}`,
                queHacer: 'Nada. Esta PC habla con el servidor sin problemas.',
            },
            token: {
                clave: 'token',
                titulo: 'Token de esta estación',
                nivel: 'ok',
                resumen: `Válido · estación «${saludo.estacion}» de la sucursal «${saludo.sucursal}»`,
                queHacer:
                    'Comprueba que esa estación y esa sucursal sean las de ESTA tienda. '
                    + 'Si no lo son, tienes instalado el token de otra: pide el correcto y '
                    + 'sustitúyelo abajo, en Configuración.',
            },
        }
    } catch (e) {
        if (e instanceof ErrorHttp && e.status === 401) {
            return {
                destino: destinoConocido(),
                servidor: {
                    clave: 'servidor',
                    titulo: 'Servidor de cobros',
                    nivel: 'ok',
                    resumen: `Se llega bien a ${cfg.apiUrl}`,
                    queHacer: 'Nada. Esta PC habla con el servidor sin problemas.',
                },
                token: {
                    clave: 'token',
                    titulo: 'Token de esta estación',
                    nivel: 'error',
                    resumen: 'El servidor rechaza este token',
                    queHacer:
                        'El token no corresponde a ninguna estación activa: o se regeneró desde el '
                        + 'sistema, o la estación se desactivó. Pide uno nuevo en Estaciones → '
                        + 'Regenerar token y pégalo abajo, en Configuración. Ojo: regenerarlo '
                        + 'invalida el anterior, así que hazlo solo para esta PC.',
                },
            }
        }

        if (e instanceof ErrorHttp) {
            return {
                destino: destinoConocido(),
                servidor: {
                    clave: 'servidor',
                    titulo: 'Servidor de cobros',
                    nivel: 'aviso',
                    resumen: `${cfg.apiUrl} contesta, pero con un error: ${e.message}`,
                    queHacer:
                        'La red está bien: el problema está en el servidor, no en esta PC. '
                        + 'Avisa a soporte con este mensaje tal cual.',
                },
                token: {
                    clave: 'token',
                    titulo: 'Token de esta estación',
                    nivel: 'desconocido',
                    resumen: 'No se pudo comprobar mientras el servidor conteste con error',
                    queHacer: 'Vuelve a probar cuando el punto de arriba esté en verde.',
                },
            }
        }

        return {
            destino: destinoConocido(),
            servidor: {
                clave: 'servidor',
                titulo: 'Servidor de cobros',
                nivel: 'error',
                resumen: `No se llega a ${cfg.apiUrl}: ${explicarFalloDeRed(e)}`,
                queHacer:
                    'Comprueba que esta PC tenga red y que la dirección de abajo, en '
                    + 'Configuración, sea la del servidor. Mientras tanto el agente reintenta '
                    + 'solo, cada vez esperando más: en cuanto el servidor vuelva, los boletos '
                    + 'pendientes salen sin que nadie haga nada.',
            },
            token: {
                clave: 'token',
                titulo: 'Token de esta estación',
                nivel: 'desconocido',
                resumen: 'No se puede saber si el token vale sin llegar al servidor',
                queHacer: 'Arregla primero el punto de arriba.',
            },
        }
    }
}

/**
 * Traduce un fallo de red a algo que se pueda leer en un mostrador.
 *
 * `fetch` de Node contesta siempre lo mismo —«fetch failed»— y esconde el
 * motivo de verdad en `error.cause`. En un panel pensado para quien no
 * programa, «fetch failed» es peor que no decir nada: parece un error del
 * agente, cuando lo que pasa es que el servidor está apagado o la dirección
 * está mal escrita, que son dos arreglos completamente distintos.
 */
export function explicarFalloDeRed(e: unknown): string {
    const error = e as { name?: string; message?: string; cause?: { code?: string; message?: string } }
    if (error?.name === 'AbortError') return 'el servidor no contestó a tiempo'

    const codigo = error?.cause?.code
    switch (codigo) {
        case 'ECONNREFUSED':
            return 'no hay nada escuchando en esa dirección (el servidor está apagado, o el puerto no es ese)'
        case 'ENOTFOUND':
        case 'EAI_AGAIN':
            return 'ese nombre de servidor no existe o no se puede resolver desde esta PC'
        case 'ETIMEDOUT':
            return 'no contestó a tiempo (esta PC no parece tener camino hasta el servidor)'
        case 'ECONNRESET':
            return 'la conexión se cortó a medias'
        case 'EHOSTUNREACH':
        case 'ENETUNREACH':
            return 'esta PC no llega a esa red'
        case 'CERT_HAS_EXPIRED':
        case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
        case 'DEPTH_ZERO_SELF_SIGNED_CERT':
            return 'el certificado https del servidor no es válido para esta PC'
        default:
            return error?.cause?.message ?? error?.message ?? 'motivo desconocido'
    }
}

/**
 * Qué tolera de verdad Windows al abrir una impresora por su nombre.
 *
 * Comprobado contra `OpenPrinter` de `winspool.drv` en Windows 11, que es
 * exactamente la función que usa `imprimirWindows`:
 *
 *     "pos", "POS", "Pos"  -> abre
 *     "POS ", " POS"       -> falla (Win32 1801)
 *     "P O S", "POS-58"    -> falla (Win32 1801)
 *
 * O sea: las mayúsculas NO importan, los espacios SÍ. La diferencia es la
 * que separa un aviso de un error, y equivocarse tiene coste real en las
 * dos direcciones. Marcar en rojo una diferencia de mayúsculas manda a
 * alguien a "arreglar" algo que ya funciona, y la próxima vez que salga un
 * rojo de verdad no se lo va a creer. Y al revés, dar por bueno un espacio
 * de más deja el fallo escondido justo donde nadie lo mira.
 */
type ParecidoNombre = 'exacto' | 'solo-mayusculas' | 'espacios' | 'ninguno'

export function compararNombreImpresora(pedido: string, instalada: string): ParecidoNombre {
    if (pedido === instalada) return 'exacto'
    if (pedido.toLowerCase() === instalada.toLowerCase()) return 'solo-mayusculas'
    if (pedido.trim().toLowerCase() === instalada.trim().toLowerCase()) return 'espacios'
    return 'ninguno'
}

async function comprobarImpresora(destino: DestinoImpresora | null): Promise<PuntoDiagnostico> {
    const base = { clave: 'impresora', titulo: 'Impresora' } as const

    if (!destino) {
        // Aun sin saber qué impresora pide el servidor, la lista de las que
        // hay instaladas es lo primero que va a preguntar soporte.
        const instaladas = await listarImpresorasWindows().catch(() => null)
        return {
            ...base,
            nivel: 'desconocido',
            resumen: 'Todavía no se sabe qué impresora usar',
            queHacer:
                'El nombre de la impresora lo manda el servidor, no se pone en esta PC. '
                + 'Hasta que el servidor conteste no hay nada que comprobar.',
            ...(instaladas
                ? { lista: instaladas, tituloLista: 'Impresoras instaladas en este PC' }
                : {}),
        }
    }

    if (destino.tipo_conexion === 'red') {
        if (!destino.ip) {
            return {
                ...base,
                nivel: 'error',
                resumen: 'El servidor dice que la impresora es de red, pero no trae ninguna IP',
                queHacer: 'Hay que completar la IP de la impresora en Estaciones, en el sistema.',
            }
        }

        const r = await probarConexionTcp(destino.ip, destino.port)
        if (r.ok) {
            return {
                ...base,
                nivel: 'ok',
                resumen: `La impresora de red ${destino.ip}:${destino.port} acepta conexión`,
                queHacer:
                    'Nada. Aun así, que acepte conexión no garantiza que tenga papel: '
                    + 'la prueba de impresión de abajo es la única que lo confirma.',
            }
        }
        return {
            ...base,
            nivel: 'error',
            resumen: `No se conecta con la impresora ${destino.ip}:${destino.port} — ${r.error}`,
            queHacer:
                'Comprueba que la impresora esté encendida, con el cable de red puesto y en la '
                + 'misma red que esta PC. Si le cambiaron la IP, hay que corregirla en '
                + 'Estaciones, en el sistema: aquí no se configura.',
        }
    }

    // ─── tipo_conexion = windows ───────────────────────────────
    if (!destino.nombre) {
        return {
            ...base,
            nivel: 'error',
            resumen: 'El servidor dice que la impresora es de Windows, pero no trae ningún nombre',
            queHacer: 'Hay que escribir el nombre de la impresora en Estaciones, en el sistema.',
        }
    }

    let instaladas: string[]
    try {
        instaladas = await listarImpresorasWindows()
    } catch (e) {
        return {
            ...base,
            nivel: 'desconocido',
            resumen: `No se pudo preguntar a Windows qué impresoras hay — ${(e as Error).message}`,
            queHacer:
                'No significa que la impresora esté mal: significa que esta comprobación no se '
                + 'pudo hacer. Usa la prueba de impresión de abajo, que sí manda papel de verdad.',
        }
    }

    const pedido = destino.nombre
    const parecidos = instaladas.map(n => ({ nombre: n, como: compararNombreImpresora(pedido, n) }))

    if (parecidos.some(p => p.como === 'exacto')) {
        return {
            ...base,
            nivel: 'ok',
            resumen: `La impresora «${pedido}» existe en este PC`,
            queHacer:
                'Nada. Que exista no garantiza que salga papel (puede estar apagada, sin papel o '
                + 'en pausa): eso lo confirma la prueba de impresión de abajo.',
        }
    }

    const porMayusculas = parecidos.find(p => p.como === 'solo-mayusculas')
    if (porMayusculas) {
        return {
            ...base,
            nivel: 'aviso',
            resumen:
                `El servidor pide «${pedido}» y en este PC se llama «${porMayusculas.nombre}»: `
                + 'solo cambian las mayúsculas, y eso a Windows le da igual, así que imprime bien',
            queHacer:
                'No hay nada roto y los boletos salen. Aun así, escribir el nombre igual en '
                + 'Estaciones evita que el próximo que mire esto pierda el rato buscando un '
                + 'problema donde no lo hay.',
            lista: instaladas,
            tituloLista: 'Impresoras instaladas en este PC',
        }
    }

    const porEspacios = parecidos.find(p => p.como === 'espacios')
    if (porEspacios) {
        return {
            ...base,
            nivel: 'error',
            resumen:
                `El servidor pide «${pedido}» y en este PC se llama «${porEspacios.nombre}»: `
                + 'la diferencia son espacios, y esos Windows SÍ los distingue',
            queHacer:
                `Escribe «${porEspacios.nombre}» tal cual en Estaciones, en el sistema, sin espacios `
                + 'de más al principio ni al final. Es el fallo más difícil de ver a ojo, porque '
                + 'los dos nombres parecen el mismo.',
            lista: instaladas,
            tituloLista: 'Impresoras instaladas en este PC',
        }
    }

    return {
        ...base,
        nivel: 'error',
        resumen: `El servidor pide la impresora «${pedido}» y en este PC no existe`,
        queHacer:
            instaladas.length === 0
                ? 'Este PC no tiene NINGUNA impresora instalada para la cuenta con la que corre el '
                  + 'agente. Instálala en Windows con esa misma cuenta (es el fallo de instalación '
                  + 'más común: ver el apartado de NSSM en el README).'
                : 'Compara con la lista de aquí abajo. O corriges el nombre en Estaciones, en el '
                  + 'sistema, para que coincida con una de esas, o renombras la impresora en este PC. '
                  + 'Si la que buscas no está en la lista, es que no está instalada para la cuenta '
                  + 'con la que corre el agente.',
        lista: instaladas,
        tituloLista: 'Impresoras instaladas en este PC',
    }
}

/**
 * Ejecuta las comprobaciones. Nunca lanza: un diagnóstico que se rompe
 * dejaría la interfaz en blanco justo cuando algo va mal.
 */
export async function ejecutarDiagnostico(cfg: Config): Promise<ResultadoDiagnostico> {
    const { servidor, token, destino } = await comprobarServidorYToken(cfg)
    const impresora = await comprobarImpresora(destino)

    return { at: new Date().toISOString(), puntos: [servidor, token, impresora] }
}

/** Reexportado para la interfaz, que enseña el destino con el mismo texto. */
export { describirDestino }
