import { spawn } from 'node:child_process'

/**
 * El único sitio por el que se le PREGUNTAN cosas a Windows.
 *
 * Listar impresoras, mirar la cola del spooler y cancelar un trabajo son
 * tres consultas distintas, pero comparten los mismos tres peligros, y
 * ninguno de ellos puede alcanzar al bucle de impresión:
 *
 * 1. **PowerShell puede tardar una eternidad.** En una PC con el spooler
 *    atascado o con una impresora de red que no contesta, `Get-Printer`
 *    se queda colgado. Por eso toda llamada lleva un tope de tiempo y, al
 *    cumplirse, se mata el proceso y se rechaza con un mensaje que dice
 *    exactamente eso — nunca se queda esperando para siempre.
 * 2. **PowerShell puede no estar.** Ediciones recortadas de Windows,
 *    políticas de grupo, un PATH raro. Rechaza con el motivo; el que
 *    llama lo convierte en «no se pudo preguntar», que NO es lo mismo que
 *    «no hay impresoras».
 * 3. **Un hijo cuyo stdout nadie lee se cuelga.** En cuanto escribe más
 *    de lo que el sistema hace de colchón (unos 64 KB) se bloquea para
 *    siempre. Aquí se drenan stdout y stderr siempre, aunque la salida
 *    solo se mire al final.
 *
 * Y una regla de seguridad: **nada de lo que escribe una persona se
 * concatena dentro del script**. El nombre de la impresora y el número de
 * trabajo viajan por variables de entorno (`$env:...`), que PowerShell lee
 * como datos y nunca como código. Un nombre de impresora con comillas o un
 * `;` no puede convertirse en un comando.
 */

/** Separador de campos de las líneas que emiten los scripts.
 *
 *  Es el carácter de control «unit separator» (0x1F): no aparece en un
 *  nombre de impresora, en un nombre de documento ni en un controlador, así
 *  que partir por él nunca parte un valor por la mitad. Un `|` o un `;` sí
 *  podrían aparecer (los nombres de controlador llevan `/` y espacios de
 *  todo tipo) y estropearían el análisis justo en la impresora rara. */
export const SEP = '\u001f'

export interface OpcionesPowerShell {
    /** Tope de tiempo. Al cumplirse se mata el proceso y se rechaza. */
    timeoutMs: number
    /** Qué se estaba intentando, en llano. Sale tal cual en el error. */
    queSeIntentaba: string
    /** Datos que el script lee con `$env:`. Nunca se concatenan al texto. */
    entorno?: Record<string, string>
}

/**
 * Ejecuta un script de PowerShell y devuelve su salida estándar.
 *
 * Rechaza —nunca devuelve una cadena vacía disimulando— si PowerShell no
 * arranca, tarda de más o termina con código distinto de 0. «No se pudo
 * preguntar» y «la respuesta está vacía» llevan a acciones distintas y no
 * se pueden confundir.
 */
export function correrPowerShell(
    script: string,
    opciones: OpcionesPowerShell,
): Promise<string> {
    const { timeoutMs, queSeIntentaba, entorno } = opciones

    return new Promise((resolver, rechazar) => {
        let terminado = false
        const acabar = (err: Error | null, salida?: string) => {
            if (terminado) return
            terminado = true
            clearTimeout(temporizador)
            if (err) rechazar(err)
            else resolver(salida ?? '')
        }

        let proceso
        try {
            proceso = spawn('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-Command', script,
            ], { env: { ...process.env, ...entorno } })
        } catch (e) {
            // spawn puede lanzar de forma síncrona (p.ej. un entorno
            // inválido). Ni siquiera eso puede escapar de este módulo.
            rechazar(new Error(`No se pudo ejecutar PowerShell para ${queSeIntentaba} — ${(e as Error).message}`))
            return
        }

        let salida = ''
        let salidaError = ''
        proceso.stdout?.on('data', d => { salida += d.toString() })
        proceso.stderr?.on('data', d => { salidaError += d.toString() })

        const temporizador = setTimeout(() => {
            proceso.kill()
            acabar(new Error(
                `Windows tardó más de ${Math.max(1, Math.round(timeoutMs / 1000))} s en ${queSeIntentaba}`,
            ))
        }, timeoutMs)

        proceso.on('error', err => {
            acabar(new Error(`No se pudo ejecutar PowerShell para ${queSeIntentaba} — ${err.message}`))
        })

        proceso.on('close', codigo => {
            if (codigo !== 0) {
                const detalle = primeraLineaUtil(salidaError) || `powershell salió con código ${codigo}`
                acabar(new Error(`Windows no pudo ${queSeIntentaba} — ${detalle}`))
                return
            }
            acabar(null, salida)
        })
    })
}

/**
 * La primera línea con contenido de un error de PowerShell.
 *
 * PowerShell escupe el mensaje y detrás cuatro o cinco líneas de rastro
 * (`+ CategoryInfo`, `+ FullyQualifiedErrorId`, la línea del script con un
 * subrayado de tildes). En un mostrador eso es ruido que tapa la única
 * línea que se entiende.
 */
export function primeraLineaUtil(texto: string): string {
    for (const linea of texto.split(/\r?\n/)) {
        const limpia = linea.trim()
        if (limpia && !limpia.startsWith('+') && !limpia.startsWith('~')) return limpia
    }
    return ''
}

/**
 * Convierte la salida de un script en filas de campos.
 *
 * Los scripts emiten UNA línea por cosa, con una marca al principio
 * (`P` para impresora, `T` para trabajo) y los campos separados por `SEP`.
 * El formato es a prueba de ruido a propósito: cualquier línea que no
 * empiece por la marca —un aviso de PowerShell, una línea en blanco, la
 * cabecera de una tabla— se ignora en vez de romper el análisis entero.
 * Igual una línea a medias: con menos campos de los esperados se descarta,
 * porque media fila enseñada como si fuera entera es peor que una fila
 * menos.
 *
 * Los campos NO se recortan. Un nombre de impresora con un espacio al
 * final es exactamente el fallo que el diagnóstico tiene que poder ver:
 * si esta función lo limpiara, ese fallo se volvería invisible.
 */
export function filasDeSalida(
    salida: string,
    marca: string,
    /** Campos esperados DESPUÉS de la marca. Con menos, la fila se descarta. */
    minimoCampos: number,
): string[][] {
    const prefijo = marca + SEP
    const filas: string[][] = []

    for (const bruta of salida.split('\n')) {
        const linea = bruta.endsWith('\r') ? bruta.slice(0, -1) : bruta
        if (!linea.startsWith(prefijo)) continue

        const campos = linea.slice(prefijo.length).split(SEP)
        if (campos.length < minimoCampos) continue
        filas.push(campos)
    }

    return filas
}
