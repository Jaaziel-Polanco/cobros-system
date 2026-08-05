import type { TrabajoImpresion, DestinoImpresora } from './tipos'

export interface RespuestaPoll {
    jobs: TrabajoImpresion[]
    /**
     * Destino de impresión completo, tal como está en la base AHORA MISMO.
     * El servidor lo manda en cada respuesta de `poll` (haya o no trabajos)
     * para que el agente nunca vote con datos más viejos que el último
     * `hello`: una estación puede cambiar de 'red' a 'windows', de IP, de
     * puerto o de nombre de impresora con el agente ya corriendo, y el
     * próximo poll debe reflejarlo sin necesidad de reiniciar el proceso.
     * Opcional solo por robustez ante una respuesta vieja o de un servidor
     * más antiguo; en operación normal siempre viene.
     */
    impresora?: DestinoImpresora
}

export interface RespuestaHello {
    estacion: string
    sucursal: string
    impresora: DestinoImpresora
    ancho_cols: number
    codepage: string
}

export const VERSION_AGENTE = '1.1.0'

/**
 * Error de una llamada HTTP al servidor, con el status adjunto.
 *
 * Sin esto, un 401 (token inválido, estación desactivada) y un timeout de
 * red se veían idénticos desde `catch (e)`: un `Error` genérico cuyo
 * único rastro del status era texto libre dentro de `.message`. El
 * llamador necesita distinguirlos de verdad — un 401 no es transitorio y
 * reintentarlo no sirve de nada — así que el status va en una propiedad,
 * no enterrado en un string a parsear.
 */
export class ErrorHttp extends Error {
    constructor(public readonly status: number, message: string) {
        super(message)
        this.name = 'ErrorHttp'
    }
}

/** Espera creciente ante fallos consecutivos, con techo de 30 s. */
export function calcularBackoff(fallosConsecutivos: number): number {
    return Math.min(1_000 * 2 ** fallosConsecutivos, 30_000)
}

export class ClienteApi {
    constructor(
        private readonly apiUrl: string,
        private readonly token: string,
        private readonly pollEsperaMs: number,
    ) {}

    /**
     * Quita el token de cualquier texto antes de que pueda llegar a un
     * `Error.message` y, de ahí, al archivo de registro.
     *
     * No hay que confiar en que el servidor nunca haga eco de lo que se le
     * envió: si alguna vez lo hace (un proxy que registra y devuelve el
     * cuerpo, un error 400 que cita la petición, etc.), el cuerpo de la
     * respuesta puede contener el token tal cual. Sanear aquí, en el único
     * punto por el que pasa toda respuesta, es la única garantía real de
     * que el token de la estación nunca queda en texto plano en
     * `agente.log`, en una PC de tienda.
     */
    private sanear(texto: string): string {
        return this.token ? texto.split(this.token).join('[TOKEN OCULTO]') : texto
    }

    private async post<T>(ruta: string, cuerpo: object, timeoutMs: number): Promise<T> {
        const controlador = new AbortController()
        const temporizador = setTimeout(() => controlador.abort(), timeoutMs)

        try {
            const resp = await fetch(`${this.apiUrl}${ruta}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // El token va en la cabecera, nunca en el cuerpo: así un eco del
                    // cuerpo en una respuesta de error (o un log que lo registre) no
                    // puede contenerlo, ni siquiera codificado (base64, etc.), que es
                    // justo lo que el saneado de `sanear()` no alcanza a cubrir.
                    Authorization: `Bearer ${this.token}`,
                },
                body: JSON.stringify({ version: VERSION_AGENTE, ...cuerpo }),
                signal: controlador.signal,
            })

            if (!resp.ok) {
                const texto = await resp.text().catch(() => '')
                throw new ErrorHttp(
                    resp.status,
                    `${ruta} respondió ${resp.status}: ${this.sanear(texto.slice(0, 200))}`,
                )
            }

            return await resp.json() as T
        } finally {
            clearTimeout(temporizador)
        }
    }

    hello(): Promise<RespuestaHello> {
        return this.post<RespuestaHello>('/api/print/hello', {}, 15_000)
    }

    poll(): Promise<RespuestaPoll> {
        return this.post<RespuestaPoll>(
            '/api/print/poll',
            { espera: this.pollEsperaMs === 0 ? 0 : undefined, max: 5 },
            this.pollEsperaMs + 15_000,
        )
    }

    ack(jobId: string, ok: boolean, error?: string): Promise<{ estado: string }> {
        return this.post<{ estado: string }>(
            '/api/print/ack', { jobId, ok, error }, 15_000,
        )
    }
}
