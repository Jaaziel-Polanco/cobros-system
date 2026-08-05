# Boletería — Plan 2: Impresión POS

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan sintaxis de checkbox (`- [ ]`) para el seguimiento.

**Goal:** Imprimir el boleto en una impresora POS 2Connect de la sucursal correspondiente, mediante una cola en la base de datos que un agente local instalado en la PC de cada sucursal consulta y ejecuta.

**Architecture:** El servidor renderiza los bytes ESC/POS completos y los deja en la tabla `print_jobs` en base64. Un agente local minúsculo en la PC de la sucursal pide trabajos a una API angosta autenticada con token de estación, abre un socket TCP contra la impresora en el puerto 9100, escribe los bytes y confirma el resultado. El agente nunca habla con Supabase y no contiene lógica de formato: cambiar el diseño de la tirilla no requiere tocar ninguna PC de tienda.

**Tech Stack:** Next.js Route Handlers (runtime nodejs), PostgreSQL con `FOR UPDATE SKIP LOCKED`, `iconv-lite` para codificación CP850, Node.js `net` para el socket TCP, Vitest, NSSM para el servicio de Windows.

**Spec:** `docs/superpowers/specs/2026-07-29-tickets-boleteria-design.md`

**Requisito previo:** el Plan 1 debe estar completo y verificado.

## Cambio de diseño posterior a la Tarea 5: dos tipos de conexión

> El plan original asumía que la impresora sería un dispositivo de red con IP propia,
> copiando la topología del servicio de restaurante de referencia. **El dueño del proyecto
> confirmó después que la impresora irá conectada directamente a la PC de la sucursal.**
>
> No hay IP a la que apuntar: hay que pasar por el spooler de Windows, mandándole los bytes
> en crudo a la impresora instalada por su nombre. Es la misma tirilla y los mismos bytes
> ESC/POS; solo cambia el último tramo del agente.
>
> **Se soportan las dos**, elegidas por estación:
>
> | Tipo | Datos que necesita | Cuándo |
> |---|---|---|
> | `red` | `impresora_ip`, `impresora_port` | Impresora con puerto Ethernet, como en el restaurante |
> | `windows` | `impresora_nombre` | Impresora conectada por USB e instalada en Windows |
>
> Mantener las dos cuesta poco y permite que cada una de las 2 sucursales elija. La ruta de
> red ya está construida y verificada; la de Windows se añade.
>
> **Tareas afectadas:** la 3 (esquema, acciones y pantalla de estaciones), la 4 (lo que el
> `hello` devuelve al agente) y la 6 (el agente propiamente dicho).
>
> **Requisito para la ruta `windows`:** la impresora debe aparecer en «Impresoras y
> escáneres» con su driver instalado, que es el caso normal de una POS. Si Windows solo la ve
> como dispositivo USB genérico, haría falta libusb y cambiar el driver con Zadig — bastante
> más incómodo y fuera del alcance de este plan.
>
> **Simulador.** Como no hay impresora disponible durante el desarrollo, la Tarea 6 incluye
> un simulador que permite verificar el agente de punta a punta sin hardware:
>
> - un servidor TCP que escucha en el 9100, recibe los bytes y dibuja en consola cómo
>   quedaría el papel;
> - un modo del agente que vuelca los bytes a un archivo en vez de imprimirlos.
>
> Con eso se verifica el reclamo, la escritura, la confirmación, los reintentos y la
> reconexión. Lo único que queda sin probar es que la impresora física entienda los bytes,
> riesgo ya mitigado porque los comandos provienen del servicio de referencia que funciona
> con ese mismo hardware.

## Global Constraints

- **Ancho de papel: 80 mm = 48 columnas.** Confirmado contra el servicio de referencia `C:\Users\jaazi\OneDrive\Desktop\trabajo\printer-service`, cuyos separadores son de 48 guiones.
- **Dos conexiones soportadas:** TCP a `ip:9100` para impresoras de red, y spooler de Windows por nombre para impresoras conectadas directamente. Ver el cambio de diseño arriba.
- **El agente local nunca recibe la service-role key de Supabase.** Solo un token de estación con dos operaciones permitidas.
- **Los errores de impresión se propagan.** El servicio de referencia (`printer-service/services/escpos.ts:14-25`) resuelve la promesa tanto en `error` como en `timeout`, y por eso marca como impreso lo que nunca salió. No repliques ese comportamiento.
- **Todo el formato vive en el servidor.** El agente no construye texto ni comandos.
- **Codificación:** los nombres de clientes llevan ñ y tildes. `Buffer.from(str)` emite UTF-8 y la impresora interpreta CP437: sale basura. Usa siempre el codificador del módulo `lib/escpos`.
- **`npx tsc --noEmit`** como verificación en cada tarea que toque TypeScript, porque `next.config.ts` tiene `typescript.ignoreBuildErrors: true`.
- **Commits** en español, formato `feat:` / `fix:` / `chore:` / `test:`.

---

## Estructura de archivos

**Crear:**

| Archivo | Responsabilidad |
|---|---|
| `lib/escpos/codificacion.ts` | Conversión de texto a bytes en el codepage de la impresora |
| `lib/escpos/comandos.ts` | Constantes y secuencias ESC/POS crudas |
| `lib/escpos/formato.ts` | Centrado, relleno y ajuste de línea a N columnas |
| `lib/escpos/tirilla-ticket.ts` | Construcción de la tirilla del boleto |
| `lib/escpos/*.test.ts` | Pruebas de los cuatro módulos anteriores |
| `lib/actions/estaciones.ts` | Server Actions de sucursales y estaciones |
| `lib/actions/impresion.ts` | Encolar trabajos y consultar el estado de la estación |
| `app/api/print/hello/route.ts` | Registro y latido del agente |
| `app/api/print/poll/route.ts` | Entrega de trabajos con reclamo atómico |
| `app/api/print/ack/route.ts` | Confirmación de resultado |
| `lib/api-print/auth.ts` | Validación del token de estación |
| `components/estaciones/estaciones-view.tsx` | Interfaz de administración |
| `app/(dashboard)/estaciones/page.tsx` | Página de administración |
| `supabase/migrations/20260729_06_print_queue.sql` | RPC de reclamo y purga |
| `print-agent/**` | Paquete del agente local |

**Modificar:**

| Archivo | Cambio |
|---|---|
| `package.json` | `iconv-lite` |
| `components/tickets/ticket-confirm-dialog.tsx` | Activar el botón de imprimir |
| `components/tickets/tickets-cliente-panel.tsx` | Acción de reimprimir |
| `components/usuarios/usuarios-view.tsx` | Asignar sucursal al agente |
| `components/layout/app-sidebar.tsx` | Entrada "Estaciones" |
| `server.js` | Purga periódica de payloads |
| `.dockerignore` | Excluir `print-agent/` |
| `DESPLIEGUE.md` | Sección de instalación del agente |

---

## Tarea 1: Codificación y primitivas ESC/POS

**Files:**
- Create: `lib/escpos/codificacion.ts`, `lib/escpos/comandos.ts`, `lib/escpos/formato.ts`
- Test: `lib/escpos/codificacion.test.ts`, `lib/escpos/formato.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nada
- Produces:
  - `aBytes(texto: string, codepage: string): Buffer`
  - `CODEPAGES: Record<string, { escT: number; iconv: string }>`
  - `CMD` con `INIT`, `cortar()`, `alinear(n)`, `tamano(n)`, `codepage(n)`, `interlineado(n)`, `TAMANO` (constantes de tamaño)
  - `comandoQR(datos: string, tamano?: number): Buffer`
  - `centrar(texto, cols)`, `linea(cols, char?)`, `dosColumnas(izq, der, cols)`, `envolver(texto, cols)`

- [ ] **Paso 1: Instalar la dependencia**

```bash
npm install iconv-lite
```

- [ ] **Paso 2: Escribir las pruebas de codificación**

Crea `lib/escpos/codificacion.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { aBytes, CODEPAGES } from './codificacion'

describe('CODEPAGES', () => {
    it('define cp850 con su selector ESC t', () => {
        expect(CODEPAGES.cp850).toEqual({ escT: 2, iconv: 'cp850' })
    })
})

describe('aBytes', () => {
    it('codifica ASCII sin cambios', () => {
        expect(aBytes('HOLA', 'cp850')).toEqual(Buffer.from([0x48, 0x4f, 0x4c, 0x41]))
    })

    it('codifica la eñe minúscula como 0xA4 en CP850', () => {
        // Sin esto, la impresora recibiría UTF-8 (0xC3 0xB1) e imprimiría basura
        expect(aBytes('ñ', 'cp850')).toEqual(Buffer.from([0xa4]))
    })

    it('codifica la eñe mayúscula como 0xA5 en CP850', () => {
        expect(aBytes('Ñ', 'cp850')).toEqual(Buffer.from([0xa5]))
    })

    it('codifica la a acentuada como 0xA0 en CP850', () => {
        expect(aBytes('á', 'cp850')).toEqual(Buffer.from([0xa0]))
    })

    it('codifica un apellido real completo', () => {
        const bytes = aBytes('Muñoz García', 'cp850')
        expect(bytes.includes(0xa4)).toBe(true)   // ñ
        expect(bytes.includes(0xa0)).toBe(true)   // á
        expect(bytes.length).toBe('Muñoz García'.length)
    })

    it('quita los diacríticos de los caracteres que el codepage no admite', () => {
        // 'ā' (macrón) no existe en CP850: debe caer a 'a', no a '?'
        expect(aBytes('ā', 'cp850')).toEqual(Buffer.from([0x61]))
    })

    it('sustituye por ? lo que no se puede representar de ninguna forma', () => {
        expect(aBytes('😀', 'cp850').toString('latin1')).toContain('?')
    })

    it('cae a cp850 si le pasan un codepage desconocido', () => {
        expect(aBytes('ñ', 'inexistente')).toEqual(Buffer.from([0xa4]))
    })
})
```

- [ ] **Paso 3: Escribir las pruebas de formato**

Crea `lib/escpos/formato.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { centrar, linea, dosColumnas, envolver } from './formato'

describe('centrar', () => {
    it('centra un texto corto en 48 columnas', () => {
        const r = centrar('ABC', 48)
        expect(r.length).toBe(48)
        expect(r.trim()).toBe('ABC')
        expect(r.indexOf('A')).toBe(22)
    })

    it('no rompe un texto que ocupa exactamente el ancho', () => {
        expect(centrar('X'.repeat(48), 48)).toBe('X'.repeat(48))
    })

    it('recorta lo que no cabe', () => {
        expect(centrar('X'.repeat(60), 48).length).toBe(48)
    })
})

describe('linea', () => {
    it('produce 48 guiones', () => {
        expect(linea(48)).toBe('-'.repeat(48))
    })

    it('acepta otro carácter', () => {
        expect(linea(10, '=')).toBe('=========='.slice(0, 10))
    })
})

describe('dosColumnas', () => {
    it('pega la etiqueta a la izquierda y el valor a la derecha', () => {
        const r = dosColumnas('Cliente', 'Juan', 48)
        expect(r.length).toBe(48)
        expect(r.startsWith('Cliente')).toBe(true)
        expect(r.endsWith('Juan')).toBe(true)
    })

    it('recorta la izquierda cuando juntas no caben', () => {
        const r = dosColumnas('X'.repeat(40), 'Y'.repeat(20), 48)
        expect(r.length).toBe(48)
        expect(r.endsWith('Y'.repeat(20))).toBe(true)
    })
})

describe('envolver', () => {
    it('deja intacto lo que cabe en una línea', () => {
        expect(envolver('corto', 48)).toEqual(['corto'])
    })

    it('parte por palabras sin exceder el ancho', () => {
        const lineas = envolver('uno dos tres cuatro cinco seis', 10)
        for (const l of lineas) expect(l.length).toBeLessThanOrEqual(10)
        expect(lineas.join(' ')).toBe('uno dos tres cuatro cinco seis')
    })

    it('parte una palabra más larga que el ancho', () => {
        const lineas = envolver('X'.repeat(25), 10)
        expect(lineas).toEqual(['X'.repeat(10), 'X'.repeat(10), 'X'.repeat(5)])
    })

    it('devuelve una línea vacía para texto vacío', () => {
        expect(envolver('', 48)).toEqual([''])
    })
})
```

- [ ] **Paso 4: Ejecutar y confirmar que fallan**

Ejecuta: `npm test -- escpos`
Esperado: FALLA con errores de resolución de `./codificacion` y `./formato`.

- [ ] **Paso 5: Implementar la codificación**

Crea `lib/escpos/codificacion.ts`:

```ts
import iconv from 'iconv-lite'

/**
 * Codepages soportados por las impresoras ESC/POS.
 * `escT` es el valor de n en el comando `ESC t n` que selecciona la tabla.
 */
export const CODEPAGES: Record<string, { escT: number; iconv: string }> = {
    cp437:  { escT: 0,  iconv: 'cp437' },
    cp850:  { escT: 2,  iconv: 'cp850' },
    cp858:  { escT: 19, iconv: 'cp858' },
    cp1252: { escT: 16, iconv: 'win1252' },
}

const POR_DEFECTO = CODEPAGES.cp850

function resolver(codepage: string) {
    return CODEPAGES[codepage] ?? POR_DEFECTO
}

/** ¿Sobrevive este carácter a una ida y vuelta por el codepage? */
function representable(ch: string, iconvName: string): boolean {
    return iconv.decode(iconv.encode(ch, iconvName), iconvName) === ch
}

/**
 * Sustituye los caracteres que el codepage no puede representar.
 * Primero intenta quitarles los diacríticos ('ā' → 'a'); si eso tampoco
 * funciona, los reemplaza por '?'.
 */
function folder(texto: string, iconvName: string): string {
    let salida = ''
    for (const ch of texto) {
        if (representable(ch, iconvName)) {
            salida += ch
            continue
        }
        const plano = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        salida += plano && plano !== ch && representable(plano, iconvName) ? plano : '?'
    }
    return salida
}

/**
 * Convierte texto a los bytes que espera la impresora.
 *
 * Nunca uses `Buffer.from(texto)` para esto: emite UTF-8, y la impresora
 * interpreta un codepage de un byte. Un apellido como "Muñoz" saldría como
 * "MuÃ±oz" en el papel.
 */
export function aBytes(texto: string, codepage: string): Buffer {
    const cfg = resolver(codepage)
    return iconv.encode(folder(texto, cfg.iconv), cfg.iconv)
}

/** Valor de n para `ESC t n` según el codepage. */
export function selectorCodepage(codepage: string): number {
    return resolver(codepage).escT
}
```

- [ ] **Paso 6: Implementar las primitivas de comandos**

Crea `lib/escpos/comandos.ts`:

```ts
/**
 * Secuencias ESC/POS. Los valores están tomados del servicio de referencia
 * que ya funciona contra las impresoras 2Connect de la empresa
 * (printer-service/services/escpos.ts), ampliados con codepage y QR.
 */

/** Valores de n para `ESC ! n` (modo de impresión). */
export const TAMANO = {
    NORMAL: 0x00,
    NEGRITA: 0x08,
    DOBLE: 0x11,      // doble ancho y doble alto
    MAXIMO: 0x30,     // cuádruple, para el número del boleto
} as const

export const CMD = {
    /** `ESC @` — reinicia la impresora. Siempre primero. */
    INIT: Buffer.from([0x1b, 0x40]),

    /** `ESC t n` — selecciona la tabla de caracteres. */
    codepage: (n: number) => Buffer.from([0x1b, 0x74, n]),

    /** `ESC 3 n` — interlineado en puntos. 30 ≈ 4 mm, igual que la referencia. */
    interlineado: (n: number) => Buffer.from([0x1b, 0x33, n]),

    /** `ESC a n` — 0 izquierda, 1 centro, 2 derecha. */
    alinear: (n: 0 | 1 | 2) => Buffer.from([0x1b, 0x61, n]),

    /** `ESC ! n` — modo de impresión. Usa las constantes de TAMANO. */
    tamano: (n: number) => Buffer.from([0x1b, 0x21, n]),

    /** `GS V 0` — corte total del papel. */
    CORTAR: Buffer.from([0x1d, 0x56, 0x00]),

    SALTO: Buffer.from('\n', 'latin1'),
} as const

/**
 * `GS ( k` — imprime un código QR.
 * Modelo 2, corrección de errores M. `tamano` va de 1 a 16.
 */
export function comandoQR(datos: string, tamano = 6): Buffer {
    const bytes = Buffer.from(datos, 'utf8')
    const longitud = bytes.length + 3
    const pL = longitud & 0xff
    const pH = (longitud >> 8) & 0xff

    return Buffer.concat([
        // Seleccionar modelo 2
        Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
        // Tamaño del módulo
        Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, tamano]),
        // Nivel de corrección de errores: 0x31 = M
        Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
        // Guardar los datos en el búfer del símbolo
        Buffer.from([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
        bytes,
        // Imprimir el símbolo guardado
        Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
    ])
}
```

- [ ] **Paso 7: Implementar el formato**

Crea `lib/escpos/formato.ts`:

```ts
/** Helpers de maquetación para papel de ancho fijo (48 columnas a 80 mm). */

export function linea(cols: number, char = '-'): string {
    return char.repeat(cols)
}

export function centrar(texto: string, cols: number): string {
    if (texto.length >= cols) return texto.slice(0, cols)
    const izquierda = Math.floor((cols - texto.length) / 2)
    return ' '.repeat(izquierda) + texto + ' '.repeat(cols - texto.length - izquierda)
}

/** Etiqueta pegada a la izquierda y valor pegado a la derecha. */
export function dosColumnas(izq: string, der: string, cols: number): string {
    const disponible = Math.max(0, cols - der.length - 1)
    const izqRecortado = izq.slice(0, disponible)
    const relleno = cols - izqRecortado.length - der.length
    return izqRecortado + ' '.repeat(Math.max(0, relleno)) + der
}

/** Parte el texto en líneas de como máximo `cols` caracteres, por palabras. */
export function envolver(texto: string, cols: number): string[] {
    if (!texto) return ['']

    const lineas: string[] = []
    let actual = ''

    for (const palabra of texto.split(/\s+/)) {
        if (!palabra) continue

        // Palabra más larga que el ancho: se parte a la fuerza
        if (palabra.length > cols) {
            if (actual) { lineas.push(actual); actual = '' }
            for (let i = 0; i < palabra.length; i += cols) {
                const trozo = palabra.slice(i, i + cols)
                if (trozo.length === cols) lineas.push(trozo)
                else actual = trozo
            }
            continue
        }

        if (!actual) actual = palabra
        else if (actual.length + 1 + palabra.length <= cols) actual += ' ' + palabra
        else { lineas.push(actual); actual = palabra }
    }

    if (actual) lineas.push(actual)
    return lineas.length ? lineas : ['']
}
```

- [ ] **Paso 8: Ejecutar las pruebas y confirmar que pasan**

Ejecuta: `npm test -- escpos`
Esperado: 20 pruebas en verde.

- [ ] **Paso 9: Commit**

```bash
git add package.json package-lock.json lib/escpos/codificacion.ts lib/escpos/codificacion.test.ts lib/escpos/comandos.ts lib/escpos/formato.ts lib/escpos/formato.test.ts
git commit -m "feat: primitivas ESC/POS con codificación CP850 y formato a 48 columnas"
```

---

## Tarea 2: Construcción de la tirilla del boleto

**Files:**
- Create: `lib/escpos/tirilla-ticket.ts`
- Test: `lib/escpos/tirilla-ticket.test.ts`

**Interfaces:**
- Consumes: `aBytes`, `selectorCodepage`, `CMD`, `TAMANO`, `comandoQR`, `centrar`, `linea`, `dosColumnas`, `envolver`; tipo `TicketSnapshot` (Plan 1, Tarea 2)
- Produces: `construirTirillaTicket(input: TirillaInput): { bytes: Buffer; preview: string }`

- [ ] **Paso 1: Escribir las pruebas que fallan**

Crea `lib/escpos/tirilla-ticket.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { construirTirillaTicket, type TirillaInput } from './tirilla-ticket'
import type { TicketSnapshot } from '@/lib/types'

const snapshot: TicketSnapshot = {
    cliente: {
        id: 'c1',
        nombre: 'Juan',
        apellido: 'Muñoz García',
        telefono: '8091112222',
        dni_ruc: '001-1234567-8',
    },
    sorteo: {
        id: 's1',
        nombre: 'Gran Sorteo Navideño',
        premio: 'Televisor 55 pulgadas',
        fecha_fin: '2026-12-31',
    },
    negocio: {
        nombre_comercial: 'Inversiones Cordero',
        rnc: '1-31-12345-6',
        direccion: 'Av. Principal 100',
        telefono: '8095551234',
        texto_legal: 'Participan solo boletos válidos al cierre del sorteo.',
        url_terminos: 'https://ejemplo.do/terminos',
        pie_impresion: 'Gracias por su preferencia',
        logo_url: null,
    },
    emitido_at_rd: '29/07/2026 03:14 PM',
    origen: 'automatico',
    version_snapshot: 1,
}

const base: TirillaInput = {
    numeroFormateado: 'BOL-000123',
    snapshot,
    esCopia: false,
    anchoCols: 48,
    codepage: 'cp850',
    urlPublica: 'http://192.168.1.50:3000/t/abc123',
}

describe('construirTirillaTicket', () => {
    it('empieza inicializando la impresora', () => {
        const { bytes } = construirTirillaTicket(base)
        expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]))
    })

    it('selecciona el codepage antes de imprimir texto', () => {
        const { bytes } = construirTirillaTicket(base)
        // ESC t 2 = CP850
        expect(bytes.includes(Buffer.from([0x1b, 0x74, 0x02]))).toBe(true)
    })

    it('termina cortando el papel', () => {
        const { bytes } = construirTirillaTicket(base)
        expect(bytes.subarray(-3)).toEqual(Buffer.from([0x1d, 0x56, 0x00]))
    })

    it('imprime el número del boleto', () => {
        const { preview } = construirTirillaTicket(base)
        expect(preview).toContain('BOL-000123')
    })

    it('codifica la eñe del apellido en CP850, no en UTF-8', () => {
        const { bytes } = construirTirillaTicket(base)
        expect(bytes.includes(0xa4)).toBe(true)              // ñ en CP850
        expect(bytes.includes(Buffer.from([0xc3, 0xb1]))).toBe(false)  // ñ en UTF-8
    })

    it('incluye el nombre del negocio, el cliente y el sorteo', () => {
        const { preview } = construirTirillaTicket(base)
        expect(preview).toContain('INVERSIONES CORDERO')
        expect(preview).toContain('Juan Muñoz García')
        expect(preview).toContain('Gran Sorteo Navideño')
    })

    it('no marca copia en la primera impresión', () => {
        const { preview } = construirTirillaTicket(base)
        expect(preview).not.toContain('COPIA')
    })

    it('marca COPIA en las reimpresiones', () => {
        const { preview } = construirTirillaTicket({ ...base, esCopia: true })
        expect(preview).toContain('*** COPIA ***')
    })

    it('incluye la secuencia de QR con la URL pública', () => {
        const { bytes } = construirTirillaTicket(base)
        // GS ( k con cn=49 fn=80 (guardar datos)
        expect(bytes.includes(Buffer.from([0x1d, 0x28, 0x6b]))).toBe(true)
        expect(bytes.includes(Buffer.from('http://192.168.1.50:3000/t/abc123', 'utf8'))).toBe(true)
    })

    it('ninguna línea de la vista previa excede el ancho', () => {
        const { preview } = construirTirillaTicket(base)
        for (const l of preview.split('\n')) {
            expect(l.length).toBeLessThanOrEqual(48)
        }
    })

    it('funciona sin sorteo asignado', () => {
        const sinSorteo = { ...base, snapshot: { ...snapshot, sorteo: null } }
        const { preview } = construirTirillaTicket(sinSorteo)
        expect(preview).toContain('BOL-000123')
        expect(preview).not.toContain('Sorteo:')
    })

    it('funciona sin cédula ni texto legal', () => {
        const minimo: TirillaInput = {
            ...base,
            snapshot: {
                ...snapshot,
                cliente: { ...snapshot.cliente, dni_ruc: null },
                negocio: { ...snapshot.negocio, texto_legal: null, pie_impresion: null },
            },
        }
        expect(() => construirTirillaTicket(minimo)).not.toThrow()
    })

    it('respeta un ancho de 32 columnas para papel de 58 mm', () => {
        const { preview } = construirTirillaTicket({ ...base, anchoCols: 32 })
        for (const l of preview.split('\n')) {
            expect(l.length).toBeLessThanOrEqual(32)
        }
    })
})
```

- [ ] **Paso 2: Ejecutar y confirmar que falla**

Ejecuta: `npm test -- tirilla`
Esperado: FALLA con error de resolución de `./tirilla-ticket`.

- [ ] **Paso 3: Implementar el constructor**

Crea `lib/escpos/tirilla-ticket.ts`:

```ts
import type { TicketSnapshot } from '@/lib/types'
import { aBytes, selectorCodepage } from './codificacion'
import { CMD, TAMANO, comandoQR } from './comandos'
import { centrar, linea, dosColumnas, envolver } from './formato'

export interface TirillaInput {
    numeroFormateado: string
    snapshot: TicketSnapshot
    esCopia: boolean
    anchoCols: number
    codepage: string
    urlPublica: string
}

/**
 * Construye la tirilla del boleto.
 *
 * Devuelve los bytes listos para escribir en el socket de la impresora y una
 * vista previa en texto plano. La vista previa se guarda junto al trabajo de
 * impresión para poder depurar desde la interfaz sin descodificar base64.
 *
 * Toda la maquetación vive aquí, en el servidor: el agente local de las
 * sucursales no sabe nada del formato y no hay que actualizarlo para
 * cambiarlo.
 */
export function construirTirillaTicket(
    input: TirillaInput,
): { bytes: Buffer; preview: string } {
    const { numeroFormateado, snapshot: s, esCopia, anchoCols: cols, codepage, urlPublica } = input

    const partes: Buffer[] = []
    const previewLineas: string[] = []

    /** Escribe una línea de texto normal, codificada y con salto. */
    const escribir = (texto: string) => {
        partes.push(aBytes(texto, codepage), CMD.SALTO)
        previewLineas.push(texto)
    }

    /** Escribe una línea con un modo de impresión distinto y vuelve a normal. */
    const escribirCon = (texto: string, modo: number, alineacion: 0 | 1 | 2 = 0) => {
        partes.push(CMD.alinear(alineacion), CMD.tamano(modo))
        partes.push(aBytes(texto.trim(), codepage), CMD.SALTO)
        partes.push(CMD.tamano(TAMANO.NORMAL), CMD.alinear(0))
        // En la vista previa el centrado se simula con espacios
        previewLineas.push(alineacion === 1 ? centrar(texto.trim(), cols) : texto.trim())
    }

    const separador = () => escribir(linea(cols))

    // ─── Cabecera ─────────────────────────────────────────────
    partes.push(CMD.INIT)
    partes.push(CMD.codepage(selectorCodepage(codepage)))
    partes.push(CMD.interlineado(30))
    partes.push(CMD.SALTO, CMD.SALTO)
    previewLineas.push('', '')

    separador()
    escribirCon(s.negocio.nombre_comercial.toUpperCase(), TAMANO.DOBLE, 1)
    if (s.negocio.rnc) escribir(centrar(`RNC: ${s.negocio.rnc}`, cols))
    if (s.negocio.telefono) escribir(centrar(`Tel: ${s.negocio.telefono}`, cols))
    separador()

    // ─── Título ───────────────────────────────────────────────
    escribir(centrar('BOLETO DE SORTEO', cols))
    if (esCopia) escribirCon('*** COPIA ***', TAMANO.NEGRITA, 1)
    escribir('')

    // ─── Número del boleto ────────────────────────────────────
    escribirCon(numeroFormateado, TAMANO.MAXIMO, 1)
    escribir('')

    // ─── Datos ────────────────────────────────────────────────
    const cliente = `${s.cliente.nombre} ${s.cliente.apellido}`
    for (const l of envolver(`Cliente:  ${cliente}`, cols)) escribir(l)
    if (s.cliente.dni_ruc) escribir(dosColumnas('Cedula/RNC:', s.cliente.dni_ruc, cols))
    escribir(dosColumnas('Fecha:', s.emitido_at_rd, cols))

    if (s.sorteo) {
        for (const l of envolver(`Sorteo:   ${s.sorteo.nombre}`, cols)) escribir(l)
        if (s.sorteo.premio) {
            for (const l of envolver(`Premio:   ${s.sorteo.premio}`, cols)) escribir(l)
        }
    }

    separador()

    // ─── QR ───────────────────────────────────────────────────
    partes.push(CMD.alinear(1))
    partes.push(comandoQR(urlPublica, 6))
    partes.push(CMD.SALTO)
    partes.push(CMD.alinear(0))
    previewLineas.push(centrar('[ QR ]', cols))
    escribir(centrar('Verifica tu boleto', cols))

    separador()

    // ─── Pie ──────────────────────────────────────────────────
    if (s.negocio.texto_legal) {
        for (const l of envolver(s.negocio.texto_legal, cols)) escribir(l)
    }
    if (s.negocio.pie_impresion) {
        for (const l of envolver(s.negocio.pie_impresion, cols)) escribir(l)
    }

    separador()
    partes.push(CMD.SALTO, CMD.SALTO, CMD.SALTO)
    previewLineas.push('', '', '')

    // ─── Corte ────────────────────────────────────────────────
    partes.push(CMD.CORTAR)

    return {
        bytes: Buffer.concat(partes),
        preview: previewLineas.join('\n'),
    }
}
```

- [ ] **Paso 4: Ejecutar las pruebas y confirmar que pasan**

Ejecuta: `npm test -- tirilla`
Esperado: 13 pruebas en verde.

Ejecuta: `npm test`
Esperado: todas las pruebas del repo en verde.

- [ ] **Paso 5: Commit**

```bash
git add lib/escpos/tirilla-ticket.ts lib/escpos/tirilla-ticket.test.ts
git commit -m "feat: construcción de la tirilla ESC/POS del boleto"
```

---

## Tarea 3: Sucursales, estaciones y tokens

**Files:**
- Create: `lib/actions/estaciones.ts`
- Create: `components/estaciones/estaciones-view.tsx`
- Create: `app/(dashboard)/estaciones/page.tsx`
- Modify: `components/layout/app-sidebar.tsx`
- Modify: `components/usuarios/usuarios-view.tsx`
- Modify: `lib/types/index.ts` (interfaz `Profile`)

**Interfaces:**
- Consumes: tablas `sucursales` y `estaciones_impresion` (Plan 1, Tarea 2)
- Produces:
  - `getSucursales(): Promise<Sucursal[]>`
  - `crearSucursal(input)`, `actualizarSucursal(id, input)`
  - `getEstaciones(): Promise<EstacionImpresion[]>`
  - `crearEstacion(input): Promise<{ estacion: EstacionImpresion; tokenPlano: string }>`
  - `actualizarEstacion(id, input)`
  - `regenerarTokenEstacion(id): Promise<{ tokenPlano: string }>`
  - `asignarSucursalUsuario(userId, sucursalId | null)`

- [ ] **Paso 1: Completar la interfaz `Profile`**

La migración del Plan 1 añadió `profiles.sucursal_id`, pero la interfaz de TypeScript se
quedó sin ese campo. Añádelo en `lib/types/index.ts`, dentro de `interface Profile`, después
de `permisos`:

```ts
    sucursal_id?: string | null
```

Es opcional porque los perfiles creados antes de la migración no la traen y porque varias
consultas del repo seleccionan solo un subconjunto de columnas.

- [ ] **Paso 2: Crear las Server Actions**

Crea `lib/actions/estaciones.ts`:

```ts
'use server'

import crypto from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Sucursal, EstacionImpresion } from '@/lib/types'

/** SHA-256 en hexadecimal. El token plano nunca se guarda. */
export async function hashToken(token: string): Promise<string> {
    return crypto.createHash('sha256').update(token).digest('hex')
}

async function exigirAdmin() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: perfil } = await supabase
        .from('profiles').select('rol').eq('id', user.id).single()

    if (perfil?.rol !== 'admin') {
        throw new Error('Solo un administrador puede gestionar sucursales y estaciones')
    }
    return supabase
}

// ─── SUCURSALES ───────────────────────────────────────────────

export async function getSucursales(): Promise<Sucursal[]> {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('sucursales').select('*').order('nombre')
    if (error) throw new Error(error.message)
    return (data ?? []) as Sucursal[]
}

export async function crearSucursal(input: {
    nombre: string; direccion?: string; telefono?: string
}): Promise<Sucursal> {
    const supabase = await exigirAdmin()

    if (!input.nombre?.trim()) throw new Error('El nombre es obligatorio')

    const { data, error } = await supabase
        .from('sucursales')
        .insert({
            nombre: input.nombre.trim(),
            direccion: input.direccion?.trim() || null,
            telefono: input.telefono?.trim() || null,
        })
        .select()
        .single()

    if (error) throw new Error(error.message)
    revalidatePath('/estaciones')
    return data as Sucursal
}

export async function actualizarSucursal(
    id: string,
    input: { nombre: string; direccion?: string; telefono?: string; activo: boolean },
): Promise<void> {
    const supabase = await exigirAdmin()

    const { error } = await supabase
        .from('sucursales')
        .update({
            nombre: input.nombre.trim(),
            direccion: input.direccion?.trim() || null,
            telefono: input.telefono?.trim() || null,
            activo: input.activo,
        })
        .eq('id', id)

    if (error) throw new Error(error.message)
    revalidatePath('/estaciones')
}

// ─── ESTACIONES ───────────────────────────────────────────────

export async function getEstaciones(): Promise<EstacionImpresion[]> {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('estaciones_impresion')
        .select('id, sucursal_id, nombre, token_prefijo, impresora_ip, impresora_port, ancho_cols, codepage, activo, ultimo_heartbeat, ultima_ip_agente, version_agente, created_at, updated_at, sucursal:sucursales(id, nombre)')
        .order('nombre')

    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as EstacionImpresion[]
}

function generarToken(): string {
    return crypto.randomBytes(24).toString('base64url')
}

/**
 * Crea una estación y devuelve su token EN CLARO una sola vez.
 * En la base de datos solo queda el hash: si se pierde, hay que regenerarlo.
 */
export async function crearEstacion(input: {
    sucursal_id: string
    nombre: string
    impresora_ip: string
    impresora_port?: number
    ancho_cols?: number
    codepage?: string
}): Promise<{ estacion: EstacionImpresion; tokenPlano: string }> {
    const supabase = await exigirAdmin()

    if (!input.nombre?.trim()) throw new Error('El nombre es obligatorio')
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(input.impresora_ip)) {
        throw new Error('La IP de la impresora no es válida')
    }

    const tokenPlano = generarToken()

    const { data, error } = await supabase
        .from('estaciones_impresion')
        .insert({
            sucursal_id: input.sucursal_id,
            nombre: input.nombre.trim(),
            token_hash: await hashToken(tokenPlano),
            token_prefijo: tokenPlano.slice(0, 8),
            impresora_ip: input.impresora_ip,
            impresora_port: input.impresora_port ?? 9100,
            ancho_cols: input.ancho_cols ?? 48,
            codepage: input.codepage ?? 'cp850',
        })
        .select()
        .single()

    if (error) {
        if (error.code === '23505') {
            throw new Error('Esa sucursal ya tiene una estación activa')
        }
        throw new Error(error.message)
    }

    revalidatePath('/estaciones')
    return { estacion: data as EstacionImpresion, tokenPlano }
}

export async function actualizarEstacion(
    id: string,
    input: {
        nombre: string
        impresora_ip: string
        impresora_port: number
        ancho_cols: number
        codepage: string
        activo: boolean
    },
): Promise<void> {
    const supabase = await exigirAdmin()

    const { error } = await supabase
        .from('estaciones_impresion')
        .update({
            nombre: input.nombre.trim(),
            impresora_ip: input.impresora_ip,
            impresora_port: input.impresora_port,
            ancho_cols: input.ancho_cols,
            codepage: input.codepage,
            activo: input.activo,
        })
        .eq('id', id)

    if (error) throw new Error(error.message)
    revalidatePath('/estaciones')
}

export async function regenerarTokenEstacion(
    id: string,
): Promise<{ tokenPlano: string }> {
    const supabase = await exigirAdmin()
    const tokenPlano = generarToken()

    const { error } = await supabase
        .from('estaciones_impresion')
        .update({
            token_hash: await hashToken(tokenPlano),
            token_prefijo: tokenPlano.slice(0, 8),
        })
        .eq('id', id)

    if (error) throw new Error(error.message)
    revalidatePath('/estaciones')
    return { tokenPlano }
}

// ─── ASIGNACIÓN DE SUCURSAL A USUARIOS ────────────────────────

export async function asignarSucursalUsuario(
    userId: string,
    sucursalId: string | null,
): Promise<void> {
    const supabase = await exigirAdmin()

    const { error } = await supabase
        .from('profiles')
        .update({ sucursal_id: sucursalId })
        .eq('id', userId)

    if (error) throw new Error(error.message)
    revalidatePath('/usuarios')
    revalidatePath('/estaciones')
}
```

- [ ] **Paso 3: Crear la interfaz de administración**

Crea `components/estaciones/estaciones-view.tsx`, componente de cliente que recibe
`sucursales: Sucursal[]` y `estaciones: EstacionImpresion[]`.

Estructura, siguiendo el patrón visual de `components/webhooks/webhooks-view.tsx`:

1. **Sección Sucursales:** tabla con nombre, dirección, teléfono, estado, y botones de crear
   y editar mediante `Dialog`.
2. **Sección Estaciones:** tarjeta por estación con:
   - Nombre y sucursal
   - `IP:puerto` de la impresora
   - Ancho en columnas y codepage
   - **Indicador de conexión**, calculado en el cliente:
     ```tsx
     const enLinea = est.ultimo_heartbeat
         ? Date.now() - new Date(est.ultimo_heartbeat).getTime() < 60_000
         : false
     ```
     Punto verde con la leyenda "En línea" o punto gris con "Sin conexión desde
     {formatearFechaHoraRD(est.ultimo_heartbeat)}".
   - `token_prefijo` seguido de `…` y un botón "Regenerar token".
   - Botón "Imprimir página de prueba", que se cablea en la Tarea 5.
3. Al crear una estación o regenerar su token, muestra el token en claro dentro de un
   `Dialog` con un aviso: *"Cópialo ahora. No se puede volver a ver."* y un botón de copiar
   al portapapeles.

- [ ] **Paso 4: Crear la página**

Crea `app/(dashboard)/estaciones/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSucursales, getEstaciones } from '@/lib/actions/estaciones'
import { EstacionesView } from '@/components/estaciones/estaciones-view'
import { PageHeader } from '@/components/layout/page-header'

export const dynamic = 'force-dynamic'

export default async function EstacionesPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: perfil } = await supabase
        .from('profiles').select('rol').eq('id', user!.id).single()

    if (perfil?.rol !== 'admin') redirect('/dashboard')

    const [sucursales, estaciones] = await Promise.all([
        getSucursales(),
        getEstaciones(),
    ])

    return (
        <div className="space-y-6 p-6">
            <PageHeader
                title="Estaciones de impresión"
                description="Sucursales e impresoras POS conectadas al sistema"
            />
            <EstacionesView sucursales={sucursales} estaciones={estaciones} />
        </div>
    )
}
```

- [ ] **Paso 5: Añadir la entrada al sidebar**

En `components/layout/app-sidebar.tsx`, añade a `ALL_NAV`:

```ts
    { href: '/estaciones', label: 'Estaciones', icon: Printer, permiso: 'admin_only' },
```

Importa `Printer` de `lucide-react`.

- [ ] **Paso 6: Añadir el selector de sucursal en usuarios**

En `components/usuarios-view.tsx` (`components/usuarios/usuarios-view.tsx`), añade en el
formulario de edición de cada usuario un `Select` de sucursal que llame a
`asignarSucursalUsuario(userId, sucursalId)`. La opción vacía significa "sin sucursal
asignada", y con ella el usuario no podrá imprimir.

La página `app/(dashboard)/usuarios/page.tsx` debe pasar `sucursales` como prop; obténlas con
`getSucursales()`.

- [ ] **Paso 7: Verificar**

Ejecuta: `npx tsc --noEmit`
Esperado: sin errores nuevos.

Con `npm run dev`, entrando como admin:

1. `/estaciones` carga.
2. Crea una sucursal.
3. Crea una estación en esa sucursal con la IP real de la impresora. **Copia el token**.
4. Intenta crear una segunda estación activa en la misma sucursal: debe rechazarla con
   "Esa sucursal ya tiene una estación activa".
5. En `/usuarios`, asigna la sucursal a tu propio usuario.
6. El indicador de conexión debe decir "Sin conexión" — todavía no existe el agente.

- [ ] **Paso 8: Commit**

```bash
git add lib/types/index.ts lib/actions/estaciones.ts components/estaciones/estaciones-view.tsx "app/(dashboard)/estaciones/page.tsx" components/layout/app-sidebar.tsx components/usuarios/usuarios-view.tsx "app/(dashboard)/usuarios/page.tsx"
git commit -m "feat: administración de sucursales y estaciones de impresión"
```

---

## Tarea 4: Cola de impresión y API del agente

**Files:**
- Create: `supabase/migrations/20260729_06_print_queue.sql`
- Create: `supabase/tests/print_queue.sql`
- Create: `lib/api-print/auth.ts`
- Create: `lib/actions/impresion.ts`
- Create: `app/api/print/hello/route.ts`, `app/api/print/poll/route.ts`, `app/api/print/ack/route.ts`

**Interfaces:**
- Consumes: `construirTirillaTicket` (Tarea 2), tabla `print_jobs` (Plan 1, Tarea 2)
- Produces:
  - RPC `reclamar_print_jobs(UUID, UUID, INTEGER) RETURNS SETOF print_jobs`
  - RPC `purgar_payloads_impresos(INTEGER) RETURNS INTEGER`
  - `autenticarEstacion(token): Promise<EstacionAutenticada | null>`
  - `imprimirTicket(ticketId, opciones?): Promise<{ jobId: string }>`
  - `getEstadoEstacionDeUsuario(): Promise<{ sucursalId, sucursalNombre, enLinea } | null>`
  - Endpoints `POST /api/print/{hello,poll,ack}`

- [ ] **Paso 1: Escribir el guion de verificación del reclamo**

Crea `supabase/tests/print_queue.sql`:

```sql
-- ══════════════════════════════════════════════════════════════
-- Verificación manual de la cola de impresión
-- Todo dentro de una transacción que termina en ROLLBACK.
-- ══════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  v_sucursal UUID;
  v_estacion UUID;
  v_cliente  UUID;
  v_ticket   UUID;
  v_job1     UUID;
  v_job2     UUID;
  v_conteo   INTEGER;
BEGIN
  INSERT INTO public.sucursales (nombre) VALUES ('Sucursal Prueba')
  RETURNING id INTO v_sucursal;

  INSERT INTO public.estaciones_impresion
    (sucursal_id, nombre, token_hash, token_prefijo, impresora_ip)
  VALUES (v_sucursal, 'Caja Prueba', 'hash-falso', 'abcd1234', '10.0.0.99')
  RETURNING id INTO v_estacion;

  INSERT INTO public.clientes (nombre, apellido, telefono)
  VALUES ('PruebaCola', 'Temporal', '8090000000')
  RETURNING id INTO v_cliente;

  INSERT INTO public.tickets
    (numero, numero_formateado, cliente_id, origen, token_publico, snapshot)
  VALUES (1, 'TST-COLA-01', v_cliente, 'manual', 'tok-prueba-cola', '{}'::jsonb)
  RETURNING id INTO v_ticket;

  INSERT INTO public.print_jobs (ticket_id, sucursal_id, payload_escpos)
  VALUES (v_ticket, v_sucursal, 'AAAA') RETURNING id INTO v_job1;

  INSERT INTO public.print_jobs (ticket_id, sucursal_id, payload_escpos)
  VALUES (v_ticket, v_sucursal, 'BBBB') RETURNING id INTO v_job2;

  -- Caso 1: reclamar devuelve los pendientes y los marca
  SELECT count(*) INTO v_conteo
  FROM public.reclamar_print_jobs(v_estacion, v_sucursal, 10);
  ASSERT v_conteo = 2, 'Caso 1: debió reclamar los 2 trabajos pendientes';

  SELECT count(*) INTO v_conteo
  FROM public.print_jobs
  WHERE sucursal_id = v_sucursal AND estado = 'reclamado' AND intentos = 1;
  ASSERT v_conteo = 2, 'Caso 1: ambos debieron quedar reclamados con 1 intento';

  -- Caso 2: reclamar de nuevo no devuelve nada (no hay pendientes)
  SELECT count(*) INTO v_conteo
  FROM public.reclamar_print_jobs(v_estacion, v_sucursal, 10);
  ASSERT v_conteo = 0, 'Caso 2: no debió reclamar trabajos ya reclamados';

  -- Caso 3: un trabajo colgado hace más de 90 s vuelve a la cola
  UPDATE public.print_jobs
     SET claimed_at = NOW() - INTERVAL '2 minutes'
   WHERE id = v_job1;

  SELECT count(*) INTO v_conteo
  FROM public.reclamar_print_jobs(v_estacion, v_sucursal, 10);
  ASSERT v_conteo = 1, 'Caso 3: debió recuperar el trabajo colgado';

  SELECT intentos INTO v_conteo FROM public.print_jobs WHERE id = v_job1;
  ASSERT v_conteo = 2, 'Caso 3: el reintento debió incrementar el contador';

  -- Caso 4: agotados los intentos, el colgado pasa a error y no se reintenta
  UPDATE public.print_jobs
     SET claimed_at = NOW() - INTERVAL '2 minutes', intentos = 3
   WHERE id = v_job1;

  PERFORM public.reclamar_print_jobs(v_estacion, v_sucursal, 10);

  ASSERT (SELECT estado FROM public.print_jobs WHERE id = v_job1) = 'error',
         'Caso 4: agotados los intentos el trabajo debe quedar en error';

  -- Caso 5: la purga limpia el payload de los impresos antiguos
  UPDATE public.print_jobs
     SET estado = 'impreso', impreso_at = NOW() - INTERVAL '30 days'
   WHERE id = v_job2;

  SELECT public.purgar_payloads_impresos(7) INTO v_conteo;
  ASSERT v_conteo >= 1, 'Caso 5: debió purgar al menos un payload';
  ASSERT (SELECT payload_escpos FROM public.print_jobs WHERE id = v_job2) IS NULL,
         'Caso 5: el payload debió quedar en NULL';
  ASSERT (SELECT estado FROM public.print_jobs WHERE id = v_job2) = 'impreso',
         'Caso 5: la fila se conserva para auditoría';

  RAISE NOTICE 'TODAS LAS VERIFICACIONES PASARON';
END $$;

ROLLBACK;
```

- [ ] **Paso 2: Ejecutar y confirmar que falla**

Ejecuta el guion en Supabase Studio.
Esperado: FALLA con `function public.reclamar_print_jobs(...) does not exist`.

- [ ] **Paso 3: Escribir la migración**

Crea `supabase/migrations/20260729_06_print_queue.sql`:

```sql
-- ══════════════════════════════════════════════════════════════
-- Migración: cola de impresión
--   · Reclamo atómico con FOR UPDATE SKIP LOCKED
--   · Recuperación de trabajos colgados
--   · Purga de payloads antiguos
-- ══════════════════════════════════════════════════════════════

/**
 * Entrega hasta p_limite trabajos pendientes de la sucursal, marcándolos
 * como reclamados en la misma sentencia.
 *
 * FOR UPDATE SKIP LOCKED garantiza que dos instancias del agente jamás
 * reciban el mismo trabajo. El servicio de referencia comprobaba una bandera
 * en JavaScript y luego escribía, lo que con dos instancias imprimía doble.
 */
CREATE OR REPLACE FUNCTION public.reclamar_print_jobs(
    p_estacion_id UUID,
    p_sucursal_id UUID,
    p_limite      INTEGER DEFAULT 5
)
RETURNS SETOF public.print_jobs AS $$
BEGIN
    -- Trabajos que quedaron reclamados sin confirmación: vuelven a la cola
    -- si les quedan intentos.
    UPDATE public.print_jobs
       SET estado      = 'pendiente',
           estacion_id = NULL,
           claimed_at  = NULL
     WHERE sucursal_id = p_sucursal_id
       AND estado      = 'reclamado'
       AND claimed_at  < NOW() - INTERVAL '90 seconds'
       AND intentos    < max_intentos;

    -- Los que agotaron los intentos se marcan como error.
    UPDATE public.print_jobs
       SET estado        = 'error',
           error_mensaje = COALESCE(error_mensaje,
                             'La estación no confirmó la impresión tras varios intentos')
     WHERE sucursal_id = p_sucursal_id
       AND estado      = 'reclamado'
       AND claimed_at  < NOW() - INTERVAL '90 seconds'
       AND intentos   >= max_intentos;

    RETURN QUERY
    UPDATE public.print_jobs
       SET estado      = 'reclamado',
           estacion_id = p_estacion_id,
           claimed_at  = NOW(),
           intentos    = intentos + 1
     WHERE id IN (
         SELECT id FROM public.print_jobs
          WHERE sucursal_id = p_sucursal_id
            AND estado      = 'pendiente'
            AND intentos    < max_intentos
          ORDER BY created_at
          LIMIT p_limite
          FOR UPDATE SKIP LOCKED
     )
    RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/**
 * Vacía el payload ESC/POS de los trabajos terminados hace más de N días.
 * La fila se conserva para auditoría; solo se libera el espacio del base64.
 */
CREATE OR REPLACE FUNCTION public.purgar_payloads_impresos(p_dias INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
    v_afectados INTEGER;
BEGIN
    UPDATE public.print_jobs
       SET payload_escpos = NULL
     WHERE payload_escpos IS NOT NULL
       AND estado IN ('impreso','cancelado','error')
       AND COALESCE(impreso_at, created_at) < NOW() - (p_dias || ' days')::INTERVAL;

    GET DIAGNOSTICS v_afectados = ROW_COUNT;
    RETURN v_afectados;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

- [ ] **Paso 4: Aplicar y ejecutar el guion**

Ejecuta la migración, luego `supabase/tests/print_queue.sql`.
Esperado: `NOTICE: TODAS LAS VERIFICACIONES PASARON`.

- [ ] **Paso 5: Crear la autenticación por token de estación**

Crea `lib/api-print/auth.ts`:

```ts
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export interface EstacionAutenticada {
    id: string
    sucursal_id: string
    nombre: string
    impresora_ip: string
    impresora_port: number
    ancho_cols: number
    codepage: string
    sucursal_nombre: string
}

/** Cliente con service-role. Solo vive en el servidor, nunca se expone. */
export function clienteAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
    )
}

/**
 * Resuelve el token de estación que envía el agente local.
 * Devuelve null si no corresponde a ninguna estación activa.
 *
 * El token se busca por su hash SHA-256, que es la clave de un índice único:
 * la comparación la hace el índice, no el código.
 */
export async function autenticarEstacion(
    token: unknown,
): Promise<EstacionAutenticada | null> {
    if (typeof token !== 'string' || token.length < 16) return null

    const hash = crypto.createHash('sha256').update(token).digest('hex')
    const supabase = clienteAdmin()

    const { data } = await supabase
        .from('estaciones_impresion')
        .select('id, sucursal_id, nombre, impresora_ip, impresora_port, ancho_cols, codepage, activo, sucursal:sucursales(nombre)')
        .eq('token_hash', hash)
        .maybeSingle()

    if (!data || !data.activo) return null

    return {
        id: data.id,
        sucursal_id: data.sucursal_id,
        nombre: data.nombre,
        impresora_ip: data.impresora_ip,
        impresora_port: data.impresora_port,
        ancho_cols: data.ancho_cols,
        codepage: data.codepage,
        sucursal_nombre:
            (data.sucursal as unknown as { nombre: string } | null)?.nombre ?? '',
    }
}

/** Registra el latido de la estación. Los fallos aquí no bloquean nada. */
export async function registrarLatido(
    estacionId: string,
    ip: string | null,
    version: string | null,
): Promise<void> {
    await clienteAdmin()
        .from('estaciones_impresion')
        .update({
            ultimo_heartbeat: new Date().toISOString(),
            ultima_ip_agente: ip,
            version_agente: version,
        })
        .eq('id', estacionId)
}
```

- [ ] **Paso 6: Crear los endpoints**

Crea `app/api/print/hello/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { autenticarEstacion, registrarLatido } from '@/lib/api-print/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
    const cuerpo = await req.json().catch(() => ({}))
    const estacion = await autenticarEstacion(cuerpo?.token)

    if (!estacion) {
        return NextResponse.json({ error: 'Token inválido' }, { status: 401 })
    }

    await registrarLatido(
        estacion.id,
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        typeof cuerpo?.version === 'string' ? cuerpo.version : null,
    )

    return NextResponse.json({
        estacion: estacion.nombre,
        sucursal: estacion.sucursal_nombre,
        impresora: { ip: estacion.impresora_ip, port: estacion.impresora_port },
        ancho_cols: estacion.ancho_cols,
        codepage: estacion.codepage,
    })
}
```

Crea `app/api/print/poll/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { autenticarEstacion, registrarLatido, clienteAdmin } from '@/lib/api-print/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ESPERA_MAX_MS = 25_000
const INTERVALO_MS = 1_500

function dormir(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Entrega trabajos de impresión al agente local.
 *
 * Mantiene la petición abierta hasta 25 s esperando trabajos (long-poll), lo
 * que hace la impresión casi instantánea sin websockets. Si el agente envía
 * `espera: 0`, responde de inmediato: es la vía de escape si algún proxy
 * inverso corta las conexiones largas.
 */
export async function POST(req: Request) {
    const cuerpo = await req.json().catch(() => ({}))
    const estacion = await autenticarEstacion(cuerpo?.token)

    if (!estacion) {
        return NextResponse.json({ error: 'Token inválido' }, { status: 401 })
    }

    const limite = Math.min(Math.max(Number(cuerpo?.max) || 5, 1), 20)
    const esperaMax = cuerpo?.espera === 0 ? 0 : ESPERA_MAX_MS
    const supabase = clienteAdmin()
    const inicio = Date.now()

    await registrarLatido(
        estacion.id,
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        typeof cuerpo?.version === 'string' ? cuerpo.version : null,
    )

    for (;;) {
        const { data, error } = await supabase.rpc('reclamar_print_jobs', {
            p_estacion_id: estacion.id,
            p_sucursal_id: estacion.sucursal_id,
            p_limite: limite,
        })

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        if (data?.length) {
            return NextResponse.json({
                jobs: data.map((j: {
                    id: string; payload_escpos: string | null; es_copia: boolean
                }) => ({
                    id: j.id,
                    payload_escpos: j.payload_escpos,
                    es_copia: j.es_copia,
                })),
                impresora: { ip: estacion.impresora_ip, port: estacion.impresora_port },
            })
        }

        if (Date.now() - inicio >= esperaMax) {
            return NextResponse.json({ jobs: [] })
        }

        await dormir(INTERVALO_MS)
    }
}
```

Crea `app/api/print/ack/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { autenticarEstacion, clienteAdmin } from '@/lib/api-print/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Confirmación del agente. `ok: false` devuelve el trabajo a la cola si le
 * quedan intentos; si no, lo deja en error con el mensaje real de la
 * impresora. Nunca se marca como impreso algo que falló.
 */
export async function POST(req: Request) {
    const cuerpo = await req.json().catch(() => ({}))
    const estacion = await autenticarEstacion(cuerpo?.token)

    if (!estacion) {
        return NextResponse.json({ error: 'Token inválido' }, { status: 401 })
    }

    const jobId = cuerpo?.jobId
    if (typeof jobId !== 'string') {
        return NextResponse.json({ error: 'jobId requerido' }, { status: 400 })
    }

    const supabase = clienteAdmin()

    const { data: job } = await supabase
        .from('print_jobs')
        .select('id, ticket_id, intentos, max_intentos, es_copia')
        .eq('id', jobId)
        .eq('sucursal_id', estacion.sucursal_id)
        .maybeSingle()

    if (!job) {
        return NextResponse.json({ error: 'Trabajo no encontrado' }, { status: 404 })
    }

    if (cuerpo?.ok === true) {
        await supabase
            .from('print_jobs')
            .update({
                estado: 'impreso',
                impreso_at: new Date().toISOString(),
                error_mensaje: null,
            })
            .eq('id', jobId)

        const { data: ticket } = await supabase
            .from('tickets').select('veces_impreso').eq('id', job.ticket_id).single()

        await supabase
            .from('tickets')
            .update({ veces_impreso: (ticket?.veces_impreso ?? 0) + 1 })
            .eq('id', job.ticket_id)

        await supabase.from('ticket_eventos').insert({
            ticket_id: job.ticket_id,
            tipo: 'impreso',
            estado: 'ok',
            es_copia: job.es_copia,
            detalle: `Impreso en ${estacion.nombre} (${estacion.sucursal_nombre})`,
        })

        return NextResponse.json({ estado: 'impreso' })
    }

    const mensaje = typeof cuerpo?.error === 'string'
        ? cuerpo.error.slice(0, 500)
        : 'Error desconocido en la estación'

    const agotado = job.intentos >= job.max_intentos
    const nuevoEstado = agotado ? 'error' : 'pendiente'

    await supabase
        .from('print_jobs')
        .update({
            estado: nuevoEstado,
            error_mensaje: mensaje,
            estacion_id: null,
            claimed_at: null,
        })
        .eq('id', jobId)

    if (agotado) {
        await supabase.from('ticket_eventos').insert({
            ticket_id: job.ticket_id,
            tipo: 'impreso',
            estado: 'error',
            es_copia: job.es_copia,
            detalle: mensaje,
        })
    }

    return NextResponse.json({ estado: nuevoEstado })
}
```

- [ ] **Paso 7: Crear la acción de encolar**

Crea `lib/actions/impresion.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getPermisos } from '@/lib/utils/permisos'
import { construirTirillaTicket } from '@/lib/escpos/tirilla-ticket'
import type { Ticket } from '@/lib/types'

/** Estación asociada al usuario actual, con su estado de conexión. */
export async function getEstadoEstacionDeUsuario(): Promise<{
    sucursalId: string
    sucursalNombre: string
    estacionNombre: string
    enLinea: boolean
} | null> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: perfil } = await supabase
        .from('profiles').select('sucursal_id').eq('id', user.id).single()

    if (!perfil?.sucursal_id) return null

    const { data: estacion } = await supabase
        .from('estaciones_impresion')
        .select('nombre, ultimo_heartbeat, sucursal:sucursales(nombre)')
        .eq('sucursal_id', perfil.sucursal_id)
        .eq('activo', true)
        .maybeSingle()

    if (!estacion) return null

    const enLinea = estacion.ultimo_heartbeat
        ? Date.now() - new Date(estacion.ultimo_heartbeat).getTime() < 60_000
        : false

    return {
        sucursalId: perfil.sucursal_id,
        sucursalNombre:
            (estacion.sucursal as unknown as { nombre: string } | null)?.nombre ?? '',
        estacionNombre: estacion.nombre,
        enLinea,
    }
}

/**
 * Encola la impresión de un boleto en la sucursal del usuario.
 *
 * Los bytes ESC/POS se construyen AQUÍ, en el servidor: el agente local no
 * conoce el formato, así que cambiar el diseño de la tirilla no obliga a
 * actualizar ninguna PC de sucursal.
 */
export async function imprimirTicket(
    ticketId: string,
    opciones?: { esCopia?: boolean },
): Promise<{ jobId: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: perfil } = await supabase
        .from('profiles').select('id, rol, permisos, sucursal_id').eq('id', user.id).single()

    if (!perfil) throw new Error('Perfil no encontrado')
    if (!getPermisos(perfil).imprimir_ticket) {
        throw new Error('No tienes permiso para imprimir boletos')
    }
    if (!perfil.sucursal_id) {
        throw new Error('Tu usuario no tiene sucursal asignada. Pídeselo a un administrador.')
    }

    const { data: estacion } = await supabase
        .from('estaciones_impresion')
        .select('ancho_cols, codepage')
        .eq('sucursal_id', perfil.sucursal_id)
        .eq('activo', true)
        .maybeSingle()

    if (!estacion) {
        throw new Error('Tu sucursal no tiene una estación de impresión activa')
    }

    const { data: ticketData, error: ticketError } = await supabase
        .from('tickets').select('*').eq('id', ticketId).single()

    if (ticketError || !ticketData) throw new Error('Boleto no encontrado')

    const ticket = ticketData as Ticket
    if (ticket.estado === 'anulado') throw new Error('El boleto está anulado')

    // La primera impresión no lleva marca; las siguientes sí.
    const esCopia = opciones?.esCopia ?? ticket.veces_impreso > 0

    const base = process.env.APP_PUBLIC_URL ?? 'http://localhost:3000'
    const { bytes, preview } = construirTirillaTicket({
        numeroFormateado: ticket.numero_formateado,
        snapshot: ticket.snapshot,
        esCopia,
        anchoCols: estacion.ancho_cols,
        codepage: estacion.codepage,
        urlPublica: `${base}/t/${ticket.token_publico}`,
    })

    const { data: job, error } = await supabase
        .from('print_jobs')
        .insert({
            ticket_id: ticket.id,
            sucursal_id: perfil.sucursal_id,
            es_copia: esCopia,
            payload_escpos: bytes.toString('base64'),
            preview_texto: preview,
            solicitado_por: user.id,
        })
        .select('id')
        .single()

    if (error) throw new Error(error.message)

    revalidatePath(`/clientes/${ticket.cliente_id}`)
    revalidatePath('/tickets')

    return { jobId: job.id }
}
```

- [ ] **Paso 8: Verificar**

Ejecuta: `npx tsc --noEmit`
Esperado: sin errores nuevos.

Verifica la API a mano con el token que copiaste en la Tarea 3:

```bash
curl -s -X POST http://localhost:3000/api/print/hello \
  -H "Content-Type: application/json" \
  -d '{"token":"TU_TOKEN","version":"0.1.0"}'
```

Esperado: JSON con el nombre de la estación, su sucursal y los datos de la impresora.

```bash
curl -s -X POST http://localhost:3000/api/print/poll \
  -H "Content-Type: application/json" \
  -d '{"token":"TU_TOKEN","espera":0}'
```

Esperado: `{"jobs":[]}` inmediatamente.

```bash
curl -s -X POST http://localhost:3000/api/print/poll \
  -H "Content-Type: application/json" \
  -d '{"token":"TOKEN_INVENTADO","espera":0}'
```

Esperado: HTTP 401.

En `/estaciones`, el indicador de la estación debe estar ahora **en línea** (el `hello`
registró el latido).

- [ ] **Paso 9: Commit**

```bash
git add supabase/migrations/20260729_06_print_queue.sql supabase/tests/print_queue.sql lib/api-print/auth.ts lib/actions/impresion.ts app/api/print
git commit -m "feat: cola de impresión con reclamo atómico y API del agente"
```

---

## Tarea 5: Activar la impresión en la interfaz

**Files:**
- Modify: `components/tickets/ticket-confirm-dialog.tsx`
- Modify: `components/tickets/tickets-cliente-panel.tsx`
- Modify: `components/estaciones/estaciones-view.tsx`
- Modify: `lib/actions/impresion.ts` (añadir la página de prueba)

**Interfaces:**
- Consumes: `imprimirTicket`, `getEstadoEstacionDeUsuario` (Tarea 4)
- Produces: `imprimirPaginaDePrueba(estacionId): Promise<{ jobId: string }>`

- [ ] **Paso 1: Añadir la impresión de prueba**

Añade estos imports **al inicio** de `lib/actions/impresion.ts`, junto a los que ya tiene:

```ts
import { aBytes, selectorCodepage } from '@/lib/escpos/codificacion'
import { CMD, TAMANO } from '@/lib/escpos/comandos'
import { centrar, linea } from '@/lib/escpos/formato'
```

Y la función **al final** del archivo:

```ts
/**
 * Encola una página de prueba en una estación concreta.
 * Incluye a propósito una línea con acentos y eñes: es la forma rápida de
 * comprobar que el codepage de esa impresora está bien configurado.
 */
export async function imprimirPaginaDePrueba(
    estacionId: string,
): Promise<{ jobId: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: perfil } = await supabase
        .from('profiles').select('rol').eq('id', user.id).single()
    if (perfil?.rol !== 'admin') {
        throw new Error('Solo un administrador puede imprimir páginas de prueba')
    }

    const { data: estacion } = await supabase
        .from('estaciones_impresion')
        .select('id, sucursal_id, nombre, ancho_cols, codepage')
        .eq('id', estacionId)
        .single()

    if (!estacion) throw new Error('Estación no encontrada')

    const cols = estacion.ancho_cols
    const cp = estacion.codepage
    const lineas = [
        linea(cols),
        centrar('PAGINA DE PRUEBA', cols),
        linea(cols),
        `Estacion: ${estacion.nombre}`,
        `Ancho:    ${cols} columnas`,
        `Codepage: ${cp}`,
        '',
        'Prueba de acentos:',
        'Muñoz Peña García Jiménez Núñez',
        'áéíóú ÁÉÍÓÚ ñÑ üÜ ¿? ¡!',
        '',
        'Si las letras de arriba se ven mal,',
        'cambia el codepage de esta estacion.',
        linea(cols),
        '', '', '',
    ]

    const partes: Buffer[] = [
        CMD.INIT,
        CMD.codepage(selectorCodepage(cp)),
        CMD.interlineado(30),
        CMD.tamano(TAMANO.NORMAL),
    ]
    for (const l of lineas) partes.push(aBytes(l, cp), CMD.SALTO)
    partes.push(CMD.CORTAR)

    const bytes = Buffer.concat(partes)

    // La página de prueba no pertenece a ningún boleto real; se ata al más
    // reciente solo para satisfacer la clave foránea.
    const { data: cualquierTicket } = await supabase
        .from('tickets').select('id').order('created_at', { ascending: false })
        .limit(1).maybeSingle()

    if (!cualquierTicket) {
        throw new Error('Emite al menos un boleto antes de imprimir una prueba')
    }

    const { data: job, error } = await supabase
        .from('print_jobs')
        .insert({
            ticket_id: cualquierTicket.id,
            sucursal_id: estacion.sucursal_id,
            es_copia: true,
            payload_escpos: bytes.toString('base64'),
            preview_texto: lineas.join('\n'),
            solicitado_por: user.id,
        })
        .select('id')
        .single()

    if (error) throw new Error(error.message)

    revalidatePath('/estaciones')
    return { jobId: job.id }
}
```

- [ ] **Paso 2: Activar el botón en el modal de confirmación**

En `components/tickets/ticket-confirm-dialog.tsx`:

Añade el import:

```ts
import { imprimirTicket } from '@/lib/actions/impresion'
```

Extiende las props:

```ts
    estacion?: { sucursalNombre: string; enLinea: boolean } | null
```

Reemplaza la función `emitir` por una que acepte la vía de entrega:

```ts
    type Via = 'whatsapp' | 'imprimir' | 'ninguna'

    const emitir = (via: Via) => {
        if (!pagoId) return
        startTransition(async () => {
            try {
                const { ticket, yaExistia } = await emitirTicketDePago(pagoId)
                setEmitido(ticket)

                toast.success(
                    yaExistia
                        ? `Este pago ya tenía el boleto ${ticket.numero_formateado}`
                        : `Boleto ${ticket.numero_formateado} generado`,
                )

                if (via === 'whatsapp') {
                    await enviarTicketWhatsApp(ticket.id)
                    toast.success('Boleto enviado por WhatsApp')
                    cerrar()
                } else if (via === 'imprimir') {
                    await imprimirTicket(ticket.id)
                    toast.success('Boleto enviado a la impresora')
                    cerrar()
                }
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error al generar el boleto')
            }
        })
    }
```

Y reemplaza el botón de imprimir deshabilitado por:

```tsx
                    <Button
                        variant="outline"
                        className="w-full justify-start gap-2"
                        disabled={pendiente || !estacion || !!emitido}
                        onClick={() => emitir('imprimir')}
                    >
                        <Printer className="h-4 w-4" />
                        Generar e imprimir
                        {estacion ? (
                            <span className="ml-auto flex items-center gap-1.5 text-[10px]">
                                <span className={`h-1.5 w-1.5 rounded-full ${estacion.enLinea ? 'bg-green-400' : 'bg-slate-600'}`} />
                                {estacion.sucursalNombre}
                            </span>
                        ) : (
                            <span className="ml-auto text-[10px] text-slate-500">
                                Sin sucursal
                            </span>
                        )}
                    </Button>
```

Cuando `estacion.enLinea` sea `false`, muestra debajo de los botones:

```tsx
                {estacion && !estacion.enLinea && (
                    <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-300">
                        La impresora de {estacion.sucursalNombre} no está conectada ahora
                        mismo. El boleto quedará en cola y se imprimirá cuando vuelva.
                    </p>
                )}
```

Los dos componentes que renderizan el diálogo (`pagos-pendientes-panel.tsx` y
`cuentas-view.tsx`) reciben ahora `estacion` como prop desde su página servidor, que la
obtiene con `getEstadoEstacionDeUsuario()`. En `pagos-pendientes-panel.tsx` la prop viaja
desde `app/(dashboard)/layout.tsx`, que ya es donde se monta el panel.

- [ ] **Paso 3: Añadir reimprimir en el panel del cliente**

En `components/tickets/tickets-cliente-panel.tsx`, importa `Printer` de `lucide-react` y
`imprimirTicket`, y añade junto a los botones de descargar y reenviar:

```tsx
                                        <button
                                            title="Imprimir"
                                            disabled={pendiente}
                                            onClick={() => reimprimir(t.id)}
                                            className="rounded p-1.5 text-slate-400 hover:bg-white/5 hover:text-[#5bbfed] disabled:opacity-30"
                                        >
                                            <Printer className="h-3.5 w-3.5" />
                                        </button>
```

con:

```ts
    const reimprimir = (ticketId: string) => {
        startTransition(async () => {
            try {
                await imprimirTicket(ticketId)
                toast.success('Enviado a la impresora')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }
```

`imprimirTicket` decide sola si es copia según `veces_impreso`, así que la segunda impresión
sale con la marca `*** COPIA ***` sin que la interfaz tenga que indicarlo.

- [ ] **Paso 4: Cablear la página de prueba**

En `components/estaciones/estaciones-view.tsx`, conecta el botón "Imprimir página de prueba"
a `imprimirPaginaDePrueba(estacion.id)`, con `toast.success('Página de prueba encolada')`.

- [ ] **Paso 5: Verificar**

Ejecuta: `npm test && npx tsc --noEmit`
Esperado: todo en verde.

Todavía no hay agente, así que nada saldrá impreso. Lo que sí debe verificarse:

1. Marca un pago y pulsa "Generar e imprimir". El toast confirma el encolado.
2. En Supabase Studio:
   ```sql
   SELECT id, estado, es_copia, length(payload_escpos) AS bytes_b64, preview_texto
   FROM public.print_jobs ORDER BY created_at DESC LIMIT 3;
   ```
   Debe haber una fila `pendiente` con su payload y su vista previa legible.
3. Lee la columna `preview_texto`: debe verse la tirilla completa en texto, con el número
   grande, el cliente y el pie.
4. Reimprime el mismo boleto desde el perfil del cliente. La `preview_texto` del segundo
   trabajo debe contener `*** COPIA ***`.
5. Con un usuario sin sucursal asignada, el botón de imprimir muestra "Sin sucursal" y la
   acción devuelve el mensaje de error correspondiente.

- [ ] **Paso 6: Commit**

```bash
git add lib/actions/impresion.ts components/tickets/ticket-confirm-dialog.tsx components/tickets/tickets-cliente-panel.tsx components/estaciones/estaciones-view.tsx components/layout/pagos-pendientes-panel.tsx components/cuentas/cuentas-view.tsx "app/(dashboard)/layout.tsx"
git commit -m "feat: activar la impresión de boletos desde la interfaz"
```

---

## Tarea 6: El agente local

**Files:**
- Create: `print-agent/package.json`, `print-agent/tsconfig.json`, `print-agent/vitest.config.ts`, `print-agent/.env.example`, `print-agent/.gitignore`
- Create: `print-agent/src/config.ts`, `print-agent/src/logger.ts`, `print-agent/src/printer.ts`, `print-agent/src/api.ts`, `print-agent/src/index.ts`
- Test: `print-agent/src/printer.test.ts`, `print-agent/src/api.test.ts`
- Create: `print-agent/README.md`
- Modify: `.dockerignore`

**Interfaces:**
- Consumes: `POST /api/print/{hello,poll,ack}` (Tarea 4)
- Produces: ejecutable `print-agent/dist/index.js`

- [ ] **Paso 1: Crear el esqueleto del paquete**

```bash
mkdir -p print-agent/src
cd print-agent
npm init -y
npm install -D typescript @types/node vitest
npx tsc --init
cd ..
```

Reemplaza `print-agent/package.json` por:

```json
{
  "name": "cobros-print-agent",
  "version": "1.0.0",
  "private": true,
  "description": "Agente local de impresión de boletos para impresoras POS 2Connect",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^20",
    "typescript": "^5",
    "vitest": "^3"
  }
}
```

No hay dependencias de producción a propósito: `net` y `fetch` son nativos de Node 20.

Reemplaza `print-agent/tsconfig.json` por:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

Crea `print-agent/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
```

Crea `print-agent/.gitignore`:

```
node_modules/
dist/
.env
agente.log
```

Crea `print-agent/.env.example`:

```env
# URL del servidor de cobros, alcanzable desde esta PC
API_URL=http://192.168.1.50:3000

# Token de la estación. Se obtiene en Estaciones → crear estación.
# Solo se muestra una vez; si se pierde hay que regenerarlo.
ESTACION_TOKEN=pega_aqui_el_token

# Espera del long-poll. Ponlo en 0 si un proxy corta las conexiones largas:
# el agente pasará a sondear cada 3 segundos.
POLL_ESPERA_MS=25000

# debug | info | warn | error
LOG_LEVEL=info
```

Añade `print-agent/` a `.dockerignore`.

- [ ] **Paso 2: Escribir las pruebas de la impresora**

Crea `print-agent/src/printer.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import net from 'node:net'
import { imprimirBytes } from './printer'

let servidor: net.Server | null = null

afterEach(() => {
    servidor?.close()
    servidor = null
})

function servidorFalso(
    alRecibir: (datos: Buffer) => void,
): Promise<number> {
    return new Promise(resolve => {
        servidor = net.createServer(socket => {
            socket.on('data', alRecibir)
        })
        servidor.listen(0, '127.0.0.1', () => {
            resolve((servidor!.address() as net.AddressInfo).port)
        })
    })
}

describe('imprimirBytes', () => {
    it('envía los bytes exactos a la impresora', async () => {
        let recibido: Buffer | null = null
        const puerto = await servidorFalso(d => { recibido = d })

        await imprimirBytes('127.0.0.1', puerto, Buffer.from([0x1b, 0x40, 0x41]))

        // Pequeña espera para que el servidor procese el 'data'
        await new Promise(r => setTimeout(r, 50))
        expect(recibido).toEqual(Buffer.from([0x1b, 0x40, 0x41]))
    })

    it('RECHAZA cuando la impresora no está accesible', async () => {
        // Puerto cerrado: el servicio de referencia resolvía en este caso y
        // marcaba como impreso lo que nunca salió. Aquí debe rechazar.
        await expect(
            imprimirBytes('127.0.0.1', 1, Buffer.from([0x41]), 500),
        ).rejects.toThrow()
    })

    it('RECHAZA por timeout cuando la impresora no responde', async () => {
        // 10.255.255.1 es una dirección no enrutable: la conexión se cuelga
        await expect(
            imprimirBytes('10.255.255.1', 9100, Buffer.from([0x41]), 300),
        ).rejects.toThrow(/[Tt]imeout/)
    })

    it('incluye la dirección en el mensaje de error', async () => {
        await expect(
            imprimirBytes('127.0.0.1', 1, Buffer.from([0x41]), 500),
        ).rejects.toThrow(/127\.0\.0\.1:1/)
    })
})
```

- [ ] **Paso 3: Ejecutar y confirmar que falla**

```bash
cd print-agent && npm test
```

Esperado: FALLA con error de resolución de `./printer`.

- [ ] **Paso 4: Implementar el cliente de impresora**

Crea `print-agent/src/printer.ts`:

```ts
import net from 'node:net'

/**
 * Escribe bytes crudos en una impresora ESC/POS por TCP.
 *
 * A diferencia del servicio de referencia del restaurante, esta función
 * RECHAZA la promesa ante cualquier fallo. Aquella resolvía también en
 * 'error' y 'timeout', y el llamador terminaba marcando como impreso lo que
 * nunca salió del papel.
 */
export function imprimirBytes(
    ip: string,
    puerto: number,
    bytes: Buffer,
    timeoutMs = 8_000,
): Promise<void> {
    return new Promise((resolver, rechazar) => {
        let terminado = false

        const acabar = (err?: Error) => {
            if (terminado) return
            terminado = true
            socket.destroy()
            err ? rechazar(err) : resolver()
        }

        const socket = net.createConnection({ host: ip, port: puerto, timeout: timeoutMs })

        socket.on('connect', () => {
            socket.write(bytes, err => {
                if (err) {
                    acabar(new Error(`Fallo al escribir en ${ip}:${puerto} — ${err.message}`))
                    return
                }
                // `end` cierra la escritura; el 'close' posterior confirma el envío
                socket.end()
            })
        })

        socket.on('error', (err: NodeJS.ErrnoException) => {
            acabar(new Error(`No se pudo imprimir en ${ip}:${puerto} — ${err.code ?? ''} ${err.message}`.trim()))
        })

        socket.on('timeout', () => {
            acabar(new Error(`Timeout de ${timeoutMs} ms conectando con ${ip}:${puerto}`))
        })

        socket.on('close', hadError => {
            if (!hadError) acabar()
        })
    })
}
```

- [ ] **Paso 5: Ejecutar las pruebas y confirmar que pasan**

```bash
cd print-agent && npm test
```

Esperado: 4 pruebas en verde.

- [ ] **Paso 6: Escribir las pruebas del cliente de API**

Crea `print-agent/src/api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ClienteApi } from './api'

const originalFetch = globalThis.fetch

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
})

function respuesta(cuerpo: unknown, status = 200) {
    return Promise.resolve(new Response(JSON.stringify(cuerpo), {
        status, headers: { 'Content-Type': 'application/json' },
    }))
}

describe('ClienteApi.poll', () => {
    it('devuelve la lista de trabajos', async () => {
        globalThis.fetch = vi.fn(() =>
            respuesta({ jobs: [{ id: 'j1', payload_escpos: 'QUJD', es_copia: false }] }),
        ) as never

        const api = new ClienteApi('http://x', 'tok', 25_000)
        const r = await api.poll()

        expect(r.jobs).toHaveLength(1)
        expect(r.jobs[0].id).toBe('j1')
    })

    it('devuelve lista vacía cuando no hay trabajos', async () => {
        globalThis.fetch = vi.fn(() => respuesta({ jobs: [] })) as never

        const api = new ClienteApi('http://x', 'tok', 25_000)
        expect((await api.poll()).jobs).toEqual([])
    })

    it('lanza con mensaje claro si el token es inválido', async () => {
        globalThis.fetch = vi.fn(() => respuesta({ error: 'Token inválido' }, 401)) as never

        const api = new ClienteApi('http://x', 'tok-malo', 25_000)
        await expect(api.poll()).rejects.toThrow(/401/)
    })

    it('lanza si la respuesta no es JSON válido', async () => {
        globalThis.fetch = vi.fn(() =>
            Promise.resolve(new Response('no soy json', { status: 200 })),
        ) as never

        const api = new ClienteApi('http://x', 'tok', 25_000)
        await expect(api.poll()).rejects.toThrow()
    })
})

describe('ClienteApi.ack', () => {
    it('envía ok true en el cuerpo', async () => {
        const espia = vi.fn(() => respuesta({ estado: 'impreso' }))
        globalThis.fetch = espia as never

        await new ClienteApi('http://x', 'tok', 25_000).ack('j1', true)

        const cuerpo = JSON.parse((espia.mock.calls[0][1] as RequestInit).body as string)
        expect(cuerpo).toMatchObject({ token: 'tok', jobId: 'j1', ok: true })
    })

    it('envía el mensaje de error cuando la impresión falló', async () => {
        const espia = vi.fn(() => respuesta({ estado: 'pendiente' }))
        globalThis.fetch = espia as never

        await new ClienteApi('http://x', 'tok', 25_000).ack('j1', false, 'impresora apagada')

        const cuerpo = JSON.parse((espia.mock.calls[0][1] as RequestInit).body as string)
        expect(cuerpo).toMatchObject({ ok: false, error: 'impresora apagada' })
    })
})

describe('calcularBackoff', () => {
    it('crece con los fallos consecutivos y se topa en 30 s', async () => {
        const { calcularBackoff } = await import('./api')
        expect(calcularBackoff(0)).toBe(1_000)
        expect(calcularBackoff(1)).toBe(2_000)
        expect(calcularBackoff(2)).toBe(4_000)
        expect(calcularBackoff(10)).toBe(30_000)
    })
})
```

- [ ] **Paso 7: Implementar el cliente de API, la configuración y el registro**

Crea `print-agent/src/config.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'

export interface Config {
    apiUrl: string
    token: string
    pollEsperaMs: number
    logLevel: string
}

/** Lector mínimo de .env: evita añadir dotenv como dependencia. */
function cargarEnv(ruta: string): void {
    if (!fs.existsSync(ruta)) return
    for (const linea of fs.readFileSync(ruta, 'utf8').split('\n')) {
        const limpia = linea.trim()
        if (!limpia || limpia.startsWith('#')) continue
        const i = limpia.indexOf('=')
        if (i === -1) continue
        const clave = limpia.slice(0, i).trim()
        const valor = limpia.slice(i + 1).trim()
        if (!(clave in process.env)) process.env[clave] = valor
    }
}

export function cargarConfig(): Config {
    cargarEnv(path.join(__dirname, '..', '.env'))

    const apiUrl = process.env.API_URL?.replace(/\/$/, '')
    const token = process.env.ESTACION_TOKEN

    if (!apiUrl) throw new Error('Falta API_URL en el archivo .env')
    if (!token || token === 'pega_aqui_el_token') {
        throw new Error('Falta ESTACION_TOKEN en el archivo .env')
    }

    return {
        apiUrl,
        token,
        pollEsperaMs: Number(process.env.POLL_ESPERA_MS ?? 25_000),
        logLevel: process.env.LOG_LEVEL ?? 'info',
    }
}
```

Crea `print-agent/src/logger.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'

const NIVELES = { debug: 10, info: 20, warn: 30, error: 40 } as const
type Nivel = keyof typeof NIVELES

const ARCHIVO = path.join(__dirname, '..', 'agente.log')
const MAX_BYTES = 5 * 1024 * 1024

let umbral: number = NIVELES.info

export function configurarLog(nivel: string): void {
    umbral = NIVELES[nivel as Nivel] ?? NIVELES.info
}

function rotarSiHaceFalta(): void {
    try {
        if (fs.existsSync(ARCHIVO) && fs.statSync(ARCHIVO).size > MAX_BYTES) {
            fs.renameSync(ARCHIVO, ARCHIVO + '.1')
        }
    } catch { /* la rotación nunca debe tumbar el agente */ }
}

function escribir(nivel: Nivel, mensaje: string): void {
    if (NIVELES[nivel] < umbral) return

    const linea = `[${new Date().toISOString()}] ${nivel.toUpperCase().padEnd(5)} ${mensaje}`
    console.log(linea)

    try {
        rotarSiHaceFalta()
        fs.appendFileSync(ARCHIVO, linea + '\n')
    } catch { /* si no se puede escribir el archivo, basta la consola */ }
}

export const log = {
    debug: (m: string) => escribir('debug', m),
    info:  (m: string) => escribir('info', m),
    warn:  (m: string) => escribir('warn', m),
    error: (m: string) => escribir('error', m),
}
```

Crea `print-agent/src/api.ts`:

```ts
export interface TrabajoImpresion {
    id: string
    payload_escpos: string | null
    es_copia: boolean
}

export interface RespuestaPoll {
    jobs: TrabajoImpresion[]
    impresora?: { ip: string; port: number }
}

export interface RespuestaHello {
    estacion: string
    sucursal: string
    impresora: { ip: string; port: number }
    ancho_cols: number
    codepage: string
}

export const VERSION_AGENTE = '1.0.0'

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

    private async post<T>(ruta: string, cuerpo: object, timeoutMs: number): Promise<T> {
        const controlador = new AbortController()
        const temporizador = setTimeout(() => controlador.abort(), timeoutMs)

        try {
            const resp = await fetch(`${this.apiUrl}${ruta}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: this.token, version: VERSION_AGENTE, ...cuerpo }),
                signal: controlador.signal,
            })

            if (!resp.ok) {
                const texto = await resp.text().catch(() => '')
                throw new Error(`${ruta} respondió ${resp.status}: ${texto.slice(0, 200)}`)
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
```

- [ ] **Paso 8: Ejecutar las pruebas y confirmar que pasan**

```bash
cd print-agent && npm test
```

Esperado: 10 pruebas en verde.

- [ ] **Paso 9: Implementar el bucle principal**

Crea `print-agent/src/index.ts`:

```ts
import { cargarConfig } from './config'
import { configurarLog, log } from './logger'
import { ClienteApi, calcularBackoff, VERSION_AGENTE, type RespuestaHello } from './api'
import { imprimirBytes } from './printer'

function dormir(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
}

async function main(): Promise<void> {
    const cfg = cargarConfig()
    configurarLog(cfg.logLevel)

    log.info('─'.repeat(52))
    log.info(`Agente de impresión de boletos v${VERSION_AGENTE}`)
    log.info(`Servidor: ${cfg.apiUrl}`)
    log.info(`Modo: ${cfg.pollEsperaMs === 0 ? 'sondeo cada 3 s' : `long-poll ${cfg.pollEsperaMs} ms`}`)
    log.info('─'.repeat(52))

    const api = new ClienteApi(cfg.apiUrl, cfg.token, cfg.pollEsperaMs)

    let saludo: RespuestaHello | null = null
    let fallos = 0

    // Presentación inicial, reintentando hasta que el servidor conteste
    for (;;) {
        try {
            saludo = await api.hello()
            log.info(`Estación "${saludo.estacion}" · sucursal "${saludo.sucursal}"`)
            log.info(`Impresora ${saludo.impresora.ip}:${saludo.impresora.port} · ${saludo.ancho_cols} columnas · ${saludo.codepage}`)
            break
        } catch (e) {
            fallos++
            const espera = calcularBackoff(fallos)
            log.error(`No se pudo contactar con el servidor: ${(e as Error).message}`)
            log.info(`Reintentando en ${espera / 1000} s...`)
            await dormir(espera)
        }
    }

    fallos = 0

    for (;;) {
        try {
            const { jobs, impresora } = await api.poll()
            fallos = 0

            const destino = impresora ?? saludo!.impresora

            for (const job of jobs) {
                if (!job.payload_escpos) {
                    log.warn(`Trabajo ${job.id} sin contenido; se descarta`)
                    await api.ack(job.id, false, 'El trabajo llegó sin contenido para imprimir')
                    continue
                }

                const bytes = Buffer.from(job.payload_escpos, 'base64')
                log.info(`Imprimiendo ${job.id} (${bytes.length} bytes)${job.es_copia ? ' [copia]' : ''}`)

                try {
                    await imprimirBytes(destino.ip, destino.port, bytes)
                    await api.ack(job.id, true)
                    log.info(`Trabajo ${job.id} impreso`)
                } catch (e) {
                    const mensaje = (e as Error).message
                    log.error(`Trabajo ${job.id} falló: ${mensaje}`)
                    // Se reporta el fallo real. El servidor decide si reintenta.
                    await api.ack(job.id, false, mensaje).catch(err =>
                        log.error(`Tampoco se pudo reportar el fallo: ${(err as Error).message}`),
                    )
                }
            }

            if (cfg.pollEsperaMs === 0) await dormir(3_000)
        } catch (e) {
            fallos++
            const espera = calcularBackoff(fallos)
            log.error(`Error consultando trabajos: ${(e as Error).message}`)
            log.debug(`Reintentando en ${espera / 1000} s`)
            await dormir(espera)
        }
    }
}

process.on('SIGINT', () => { log.info('Detenido por el usuario'); process.exit(0) })
process.on('SIGTERM', () => { log.info('Detenido por el sistema'); process.exit(0) })

main().catch(e => {
    log.error(`Error fatal: ${(e as Error).message}`)
    process.exit(1)
})
```

- [ ] **Paso 10: Escribir el README de instalación**

Crea `print-agent/README.md`:

````markdown
# Agente de impresión de boletos

Servicio que corre en la PC de cada sucursal, recibe los boletos a imprimir del
sistema de cobros y los envía a la impresora POS 2Connect por red.

No guarda datos ni tiene acceso a la base de datos: solo puede pedir sus
trabajos y confirmarlos, autenticándose con un token propio de la estación.

## Requisitos

- Node.js 20 o superior
- La impresora conectada a la red, con IP fija y el puerto 9100 accesible
- Que esta PC alcance el servidor de cobros

## Instalación

1. Copia esta carpeta a `C:\cobros-print-agent`.

2. Instala y compila:

   ```powershell
   cd C:\cobros-print-agent
   npm install
   npm run build
   ```

3. Crea la estación en el sistema de cobros: entra como administrador a
   **Estaciones**, pulsa "Nueva estación", elige la sucursal e introduce la IP de
   la impresora. **Copia el token que aparece: solo se muestra una vez.**

4. Crea el archivo `.env` a partir de `.env.example`:

   ```env
   API_URL=http://192.168.1.50:3000
   ESTACION_TOKEN=el_token_que_copiaste
   POLL_ESPERA_MS=25000
   LOG_LEVEL=info
   ```

5. Pruébalo a mano:

   ```powershell
   npm start
   ```

   Debe mostrar el nombre de la estación y su sucursal. Desde el sistema, en
   **Estaciones**, pulsa "Imprimir página de prueba": debe salir papel.

   Comprueba en el papel que las eñes y las tildes se ven bien. Si salen
   caracteres raros, cambia el codepage de la estación (`cp850` → `cp858` o
   `cp1252`) y repite la prueba. No hace falta tocar esta PC: el formato lo
   genera el servidor.

## Instalarlo como servicio de Windows

Con [NSSM](https://nssm.cc/download), que es lo más fiable en Windows:

```powershell
# Descomprime nssm.exe en C:\nssm y ejecuta como Administrador
C:\nssm\nssm.exe install CobrosPrintAgent "C:\Program Files\nodejs\node.exe" "C:\cobros-print-agent\dist\index.js"
C:\nssm\nssm.exe set CobrosPrintAgent AppDirectory C:\cobros-print-agent
C:\nssm\nssm.exe set CobrosPrintAgent Start SERVICE_AUTO_START
C:\nssm\nssm.exe set CobrosPrintAgent AppStdout C:\cobros-print-agent\servicio.log
C:\nssm\nssm.exe set CobrosPrintAgent AppStderr C:\cobros-print-agent\servicio.log
C:\nssm\nssm.exe start CobrosPrintAgent
```

Comandos útiles:

```powershell
C:\nssm\nssm.exe status  CobrosPrintAgent
C:\nssm\nssm.exe restart CobrosPrintAgent
C:\nssm\nssm.exe stop    CobrosPrintAgent
C:\nssm\nssm.exe remove  CobrosPrintAgent confirm
```

## Registro de actividad

`agente.log` en la carpeta del agente, con rotación automática a los 5 MB.

## Diagnóstico

| Síntoma | Causa probable | Solución |
|---|---|---|
| `respondió 401` | Token equivocado o estación desactivada | Regenera el token en Estaciones y actualiza el `.env` |
| `No se pudo contactar con el servidor` | `API_URL` mal, o el servidor apagado | Comprueba la URL desde el navegador de esta PC |
| `ECONNREFUSED` al imprimir | Impresora apagada o IP equivocada | Haz ping a la IP; revísala en Estaciones |
| `Timeout ... conectando` | La impresora no responde en el puerto 9100 | Verifica que tenga la red configurada y el puerto abierto |
| Sale papel con símbolos raros | Codepage equivocado | Cambia el codepage de la estación desde el sistema |
| No sale nada y no hay error | El servicio está parado | `nssm status CobrosPrintAgent` |

En el sistema, la pantalla **Estaciones** muestra si el agente está en línea:
manda un latido en cada consulta, y se considera desconectado tras 60 segundos
sin señal.
````

- [ ] **Paso 11: Verificación de extremo a extremo**

```bash
cd print-agent && npm run build && npm start
```

1. El agente saluda y muestra su estación y sucursal.
2. En `/estaciones`, el indicador pasa a **en línea**.
3. Pulsa "Imprimir página de prueba". **Debe salir papel** en menos de 3 segundos.
4. Comprueba en el papel: "Muñoz Peña García Jiménez Núñez" y "áéíóú ÁÉÍÓÚ ñÑ üÜ" legibles.
   Si no, prueba `cp858` y luego `cp1252` en la estación.
5. Emite un boleto e imprímelo. Verifica número grande, QR escaneable (debe abrir `/t/...`)
   y corte de papel.
6. Reimprime el mismo boleto: debe salir con `*** COPIA ***`.
7. **Apaga la impresora** e imprime. En Supabase el trabajo debe llegar a `error` tras 3
   intentos, con el mensaje real (`ECONNREFUSED` o timeout), y **nunca** como `impreso`.
   Esta es la regresión directa del defecto del servicio de referencia.
8. **Detén el agente**, imprime dos boletos, vuelve a arrancarlo. Deben salir los dos.

- [ ] **Paso 12: Commit**

```bash
git add print-agent .dockerignore
git commit -m "feat: agente local de impresión para las PC de sucursal"
```

---

## Tarea 7: Purga automática de payloads

**Files:**
- Modify: `server.js`
- Modify: `DESPLIEGUE.md`

**Interfaces:**
- Consumes: RPC `purgar_payloads_impresos` (Tarea 4)
- Produces: tarea programada diaria

- [ ] **Paso 1: Añadir la tarea al cron embebido**

En `server.js`, después de la definición de `dispararRecordatorios`, añade:

```js
const PURGA_SCHEDULE = process.env.PURGA_SCHEDULE ?? "30 3 * * *";
const PURGA_DIAS = parseInt(process.env.PURGA_DIAS ?? "7", 10);

/**
 * Vacía el contenido ESC/POS de los trabajos de impresión ya terminados.
 * Las filas se conservan para auditoría; solo se libera el base64, que es
 * lo único que ocupa espacio de verdad.
 */
async function purgarPayloadsImpresion() {
  if (isShuttingDown) return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("[PURGA] ❌ Faltan credenciales de Supabase. Omitida.");
    return;
  }

  try {
    const res = await fetch(`${url}/rest/v1/rpc/purgar_payloads_impresos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ p_dias: PURGA_DIAS }),
    });

    if (!res.ok) {
      console.error(`[PURGA] ⚠️ Respuesta ${res.status}: ${await res.text()}`);
      return;
    }

    console.log(`[PURGA] ✅ ${await res.text()} payloads liberados`);
  } catch (err) {
    console.error(`[PURGA] ❌ Error: ${err.message}`);
  }
}
```

Y dentro de `server.listen(...)`, después de programar `cronTask`:

```js
    if (cron.validate(PURGA_SCHEDULE)) {
      cron.schedule(PURGA_SCHEDULE, purgarPayloadsImpresion, {
        timezone: "America/Santo_Domingo",
      });
      console.log(
        `[PURGA] 🧹 Programada: "${PURGA_SCHEDULE}" (retención: ${PURGA_DIAS} días)`,
      );
    }
```

- [ ] **Paso 2: Documentar el despliegue**

En `DESPLIEGUE.md`, añade una sección **"Impresión en sucursales"** que explique:

- La arquitectura: la web encola, el agente de cada sucursal consulta e imprime.
- Que hay que crear las sucursales y estaciones desde `/estaciones` antes de instalar nada.
- Que la instalación del agente está documentada en `print-agent/README.md`.
- Las variables nuevas: `PURGA_SCHEDULE` (por defecto `30 3 * * *`) y `PURGA_DIAS` (por
  defecto `7`).
- Que `print-agent/` está excluido de la imagen Docker a propósito, porque se instala en las
  PC de sucursal y no en el servidor.

Añade también esas dos variables a `.env.example`.

- [ ] **Paso 3: Verificar**

Reinicia el servidor con `npm start` y comprueba que en el arranque aparece la línea
`[PURGA] 🧹 Programada: ...`.

Prueba la purga a mano desde Supabase Studio:

```sql
SELECT public.purgar_payloads_impresos(0);
```

Esperado: un número. Comprueba que los `print_jobs` en estado `impreso` quedaron con
`payload_escpos` en `NULL` pero conservan su fila y su `preview_texto`.

- [ ] **Paso 4: Commit**

```bash
git add server.js DESPLIEGUE.md .env.example
git commit -m "feat: purga programada de los payloads de impresión"
```

---

## Tarea 8: Ver y controlar la cola de impresión

> **Añadida después de la revisión de rama del Plan 2.** No estaba en el plan original y
> no es una corrección: es funcionalidad que faltaba y que la revisión hizo evidente.

**El problema.** Hoy no existe ni una sola lectura de `print_jobs` en la interfaz. Eso
significa que:

- Un trabajo que terminó en `error` es **invisible**. La cajera vio el aviso de éxito al
  encolar y nadie se entera nunca de que el papel no salió.
- El estado `cancelado` está declarado en los tipos pero **no lo escribe nadie**: no hay
  forma de cancelar un trabajo.
- Como el índice `uq_print_jobs_ticket_en_vuelo` cuenta los trabajos `pendiente` y
  `reclamado`, un trabajo colgado —de una estación que se desactivó, por ejemplo— **bloquea
  para siempre** toda reimpresión de ese boleto, y la única salida es editar la base a mano.

Ese último punto es el que convierte esto en algo más que una comodidad.

**Files:**
- Create: `components/estaciones/cola-impresion.tsx`
- Modify: `lib/actions/impresion.ts`, `components/estaciones/estaciones-view.tsx`,
  `app/(dashboard)/estaciones/page.tsx`, `components/tickets/tickets-cliente-panel.tsx`,
  `app/(dashboard)/clientes/[id]/page.tsx`

**Interfaces:**
- Consumes: tabla `print_jobs`, `getPermisos`, `formatearFechaHoraRD`
- Produces:
  - `getColaImpresion(sucursalId?): Promise<PrintJob[]>` — admin
  - `cancelarTrabajoImpresion(jobId, motivo): Promise<void>`
  - `reencolarTrabajoImpresion(jobId): Promise<{ jobId: string }>`
  - `getEstadoImpresionTickets(ticketIds): Promise<Map<string, EstadoPrintJob>>`

### Lo que hay que construir

**1. La cola en `/estaciones`, para administradores.** Bajo cada estación, los trabajos de
su sucursal que no estén terminados hace tiempo: estado, boleto al que pertenecen (o la
marca de página de prueba), cuándo se encoló, cuántos intentos lleva y el mensaje de error
si lo hay. Ordenados por antigüedad, los problemáticos primero.

Que se pueda ver la `preview_texto` de un trabajo: existe justamente para depurar sin
descodificar base64, y hoy no la mira nadie.

**2. Cancelar.** Un trabajo `pendiente` o `reclamado` puede cancelarse, con motivo. Escribe
`cancelado`, que libera el índice único y desbloquea las reimpresiones de ese boleto. Es la
salida al problema del trabajo colgado.

**3. Reencolar.** Un trabajo en `error` puede volver a la cola. Es lo que querrá hacer quien
arregle la impresora: reintentar sin tener que emitir otro boleto.

Ojo: reencolar un trabajo cuyo boleto ya tiene otro en vuelo choca con el índice único.
Trátalo con un mensaje entendible, no con el error crudo de Postgres.

**4. El estado en el perfil del cliente.** Junto a cada boleto, si tiene un trabajo de
impresión reciente, mostrar en qué estado está. Basta con un indicador discreto: lo que hoy
falta es que la cajera pueda saber que su impresión falló, sin tener que preguntarle a un
administrador.

### Permisos

La cola completa de una sucursal es cosa de administradores. El estado del propio boleto,
de quien pueda ver ese boleto.

**Comprueba la coherencia entre las tres capas** —interfaz, Server Action y policy RLS— para
cada acción nueva. Es el defecto que más veces ha aparecido en estos dos planes: seis, entre
ambos. La policy de SELECT de `print_jobs` para no-admin es hoy `solicitado_por = auth.uid()`,
así que decide conscientemente qué debe poder ver cada rol y hazlo coincidir en las tres.

`cancelar` y `reencolar` escriben en `print_jobs`, tabla que **no tiene hoy ninguna policy de
UPDATE para no-admin**. Si decides que un agente pueda cancelar sus propios trabajos, hará
falta la policy; si no, que la interfaz no se lo ofrezca.

### Verificación

- Encolar, cancelar, y comprobar que **el boleto vuelve a poder imprimirse**: es el desbloqueo
  que motiva la tarea.
- Provocar un trabajo en `error`, reencolarlo y verificar que vuelve a `pendiente`.
- Intentar reencolar cuando el boleto ya tiene otro en vuelo: mensaje entendible.
- Que un trabajo de prueba se distinga en la lista y no aparente pertenecer a un boleto.
- Que un agente no vea la cola de otra sucursal.

---

## Verificación final del Plan 2

- [ ] `npm test` en la raíz — todo en verde
- [ ] `cd print-agent && npm test` — todo en verde
- [ ] `npx tsc --noEmit` — sin errores
- [ ] `npm run build` — el build de producción completa
- [ ] `supabase/tests/print_queue.sql` pasa
- [ ] Sale papel real en la 2Connect con el número, el QR escaneable y el corte
- [ ] Las eñes y tildes se imprimen correctamente
- [ ] Con la impresora apagada, el trabajo termina en `error`, nunca en `impreso`
- [ ] Con el agente parado, los trabajos se acumulan y salen todos al reiniciarlo
- [ ] La reimpresión sale marcada como COPIA
- [ ] El agente arranca solo tras reiniciar Windows

**Al terminar, continúa con el Plan 3 (sorteos).**
