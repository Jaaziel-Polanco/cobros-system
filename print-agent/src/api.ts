import type { TrabajoImpresion, DestinoImpresora } from './tipos'

export interface RespuestaPoll {
    jobs: TrabajoImpresion[]
    /**
     * Datos de red que trae `poll` para refrescarse sin esperar a un nuevo
     * `hello`. Solo `ip`/`port`: el servidor no manda `tipo_conexion` ni
     * `nombre` aquí porque el `hello` ya los fija para toda la sesión y una
     * estación no cambia de transporte en caliente. El agente completa lo
     * que falte con lo que le dio el `hello`.
     */
    impresora?: { ip: string; port: number }
}

export interface RespuestaHello {
    estacion: string
    sucursal: string
    impresora: DestinoImpresora
    ancho_cols: number
    codepage: string
}

export const VERSION_AGENTE = '1.1.0'

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
                throw new Error(`${ruta} respondió ${resp.status}: ${this.sanear(texto.slice(0, 200))}`)
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
