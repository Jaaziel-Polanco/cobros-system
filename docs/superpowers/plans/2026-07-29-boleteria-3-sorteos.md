# Boletería — Plan 3: Sorteos

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan sintaxis de checkbox (`- [ ]`) para el seguimiento.

**Goal:** Seleccionar ganadores al azar entre los boletos emitidos en un rango de fechas, de forma que el resultado sea reproducible y demostrable ante cualquier cliente que dude de la limpieza del sorteo.

**Architecture:** El algoritmo de selección es una función pura de TypeScript, sin efectos secundarios ni acceso a red, alimentada por un generador pseudoaleatorio con semilla. La semilla se guarda junto con la lista completa de participantes y su orden tras el barajado, de modo que cualquiera puede reconstruir el sorteo entero desde los datos almacenados y comprobar que salen exactamente los mismos ganadores. La persistencia ocurre en un único RPC para que una ejecución nunca quede a medias.

**Tech Stack:** TypeScript puro para el algoritmo, Vitest para las pruebas, PostgreSQL para la persistencia atómica, Next.js Server Actions y shadcn/ui para la interfaz.

**Spec:** `docs/superpowers/specs/2026-07-29-tickets-boleteria-design.md`

**Requisito previo:** el Plan 1 debe estar completo. El Plan 2 no es necesario para éste.

## Global Constraints

- **Prohibido `Math.random()`** en cualquier punto del camino del sorteo. Si aparece, el sorteo deja de ser reproducible y la auditoría no vale nada.
- **El algoritmo vive en un solo sitio**, en TypeScript. No se reimplementa en PL/pgSQL: dos implementaciones del mismo barajado terminan divergiendo.
- **Rangos de fecha en hora de República Dominicana.** Usa siempre `rangoRDaUTC` de `lib/utils/fecha-rd.ts`.
- **Un cliente no puede ganar dos veces** en la misma ejecución. La regla se aplica en el algoritmo y además está reforzada por el índice único `uq_ganador_cliente` en la base de datos.
- **Nada se borra.** Re-ejecutar un sorteo crea una ejecución nueva y marca la anterior como no vigente.
- **La versión del algoritmo se guarda** en cada ejecución (`mulberry32-fisher-yates-v1`). Si algún día cambia, las ejecuciones antiguas siguen siendo verificables con su versión.
- **`npx tsc --noEmit`** como verificación en cada tarea, porque `next.config.ts` tiene `typescript.ignoreBuildErrors: true`.
- **Commits** en español, formato `feat:` / `fix:` / `chore:` / `test:`.

---

## Estructura de archivos

**Crear:**

| Archivo | Responsabilidad |
|---|---|
| `lib/utils/sorteo.ts` | PRNG con semilla, barajado y selección de ganadores. Funciones puras |
| `lib/utils/sorteo.test.ts` | Pruebas del algoritmo |
| `lib/actions/sorteos.ts` | Server Actions de sorteos y ejecuciones |
| `lib/validations/sorteos.ts` | Esquemas Zod |
| `supabase/migrations/20260729_07_ejecutar_sorteo.sql` | RPC de persistencia atómica |
| `supabase/tests/ejecutar_sorteo.sql` | Verificación manual del RPC |
| `components/sorteos/sorteos-view.tsx` | Listado de sorteos |
| `components/sorteos/sorteo-form-dialog.tsx` | Alta y edición |
| `components/sorteos/ejecutar-sorteo-dialog.tsx` | Diálogo de ejecución |
| `components/sorteos/ganadores-panel.tsx` | Ganadores y verificación |
| `app/(dashboard)/sorteos/page.tsx` | Página del listado |
| `app/(dashboard)/sorteos/[id]/page.tsx` | Página de detalle |

**Modificar:**

| Archivo | Cambio |
|---|---|
| `lib/actions/tickets.ts` | Acción de asignar boletos huérfanos a un sorteo |
| `components/tickets/tickets-view.tsx` | Acción masiva sobre huérfanos |
| `components/layout/app-sidebar.tsx` | **Volver a añadir** la entrada `/sorteos` |

> **Nota:** la entrada `/sorteos` del menú lateral se creó en el Plan 1 y se **retiró** en la
> revisión final de esa rama, porque apuntaba a una ruta inexistente y los administradores
> recibían un 404. La Tarea 4 de este plan debe volver a añadirla, junto con la ruta:
>
> ```ts
>     { href: '/sorteos', label: 'Sorteos', icon: Gift, permiso: 'ver_sorteos' },
> ```
>
> El icono `Gift` viene de `lucide-react`.

---

## Tarea 1: Algoritmo determinista de selección

Es el corazón del módulo y lo único que hay que poder defender ante un cliente molesto. Va primero, aislado, y con pruebas exhaustivas.

**Files:**
- Create: `lib/utils/sorteo.ts`
- Test: `lib/utils/sorteo.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `ALGORITMO_SORTEO = 'mulberry32-fisher-yates-v1'`
  - `xmur3(texto: string): () => number`
  - `mulberry32(semilla: number): () => number`
  - `hashSemilla(texto: string): number`
  - `barajarDeterminista<T>(items: readonly T[], rng: () => number): T[]`
  - `calcularPoolHash(ids: readonly string[]): string`
  - `seleccionarGanadores(pool, cantidad, semilla): ResultadoSorteo`
  - Tipos `TicketParticipante`, `ResultadoSorteo`

- [ ] **Paso 1: Escribir las pruebas que fallan**

Crea `lib/utils/sorteo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
    mulberry32,
    hashSemilla,
    barajarDeterminista,
    calcularPoolHash,
    seleccionarGanadores,
    ALGORITMO_SORTEO,
    type TicketParticipante,
} from './sorteo'

/** Genera un pool de prueba: `porCliente` boletos para cada uno de `clientes`. */
function pool(clientes: number, porCliente = 1): TicketParticipante[] {
    const items: TicketParticipante[] = []
    let n = 1
    for (let c = 1; c <= clientes; c++) {
        for (let k = 0; k < porCliente; k++) {
            items.push({ id: `t${n}`, numero: n, cliente_id: `c${c}` })
            n++
        }
    }
    return items
}

describe('ALGORITMO_SORTEO', () => {
    it('está versionado', () => {
        expect(ALGORITMO_SORTEO).toBe('mulberry32-fisher-yates-v1')
    })
})

describe('mulberry32', () => {
    it('produce la misma secuencia con la misma semilla', () => {
        const a = mulberry32(12345)
        const b = mulberry32(12345)
        const sa = [a(), a(), a(), a(), a()]
        const sb = [b(), b(), b(), b(), b()]
        expect(sa).toEqual(sb)
    })

    it('produce secuencias distintas con semillas distintas', () => {
        const a = mulberry32(1)
        const b = mulberry32(2)
        expect([a(), a(), a()]).not.toEqual([b(), b(), b()])
    })

    it('devuelve valores en el intervalo [0, 1)', () => {
        const r = mulberry32(999)
        for (let i = 0; i < 1000; i++) {
            const v = r()
            expect(v).toBeGreaterThanOrEqual(0)
            expect(v).toBeLessThan(1)
        }
    })
})

describe('hashSemilla', () => {
    it('es determinista', () => {
        expect(hashSemilla('abc')).toBe(hashSemilla('abc'))
    })

    it('distingue textos distintos', () => {
        expect(hashSemilla('abc')).not.toBe(hashSemilla('abd'))
    })

    it('devuelve un entero sin signo de 32 bits', () => {
        const h = hashSemilla('cualquier-cosa')
        expect(Number.isInteger(h)).toBe(true)
        expect(h).toBeGreaterThanOrEqual(0)
        expect(h).toBeLessThanOrEqual(0xffffffff)
    })
})

describe('barajarDeterminista', () => {
    it('conserva todos los elementos', () => {
        const items = [1, 2, 3, 4, 5, 6, 7, 8]
        const r = barajarDeterminista(items, mulberry32(7))
        expect([...r].sort((a, b) => a - b)).toEqual(items)
    })

    it('no muta el arreglo original', () => {
        const items = [1, 2, 3, 4, 5]
        barajarDeterminista(items, mulberry32(7))
        expect(items).toEqual([1, 2, 3, 4, 5])
    })

    it('da el mismo resultado con la misma semilla', () => {
        const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        expect(barajarDeterminista(items, mulberry32(42)))
            .toEqual(barajarDeterminista(items, mulberry32(42)))
    })

    it('realmente reordena con un pool grande', () => {
        const items = Array.from({ length: 100 }, (_, i) => i)
        expect(barajarDeterminista(items, mulberry32(3))).not.toEqual(items)
    })
})

describe('calcularPoolHash', () => {
    it('no depende del orden de entrada', () => {
        expect(calcularPoolHash(['b', 'a', 'c'])).toBe(calcularPoolHash(['a', 'b', 'c']))
    })

    it('cambia si cambia el conjunto', () => {
        expect(calcularPoolHash(['a', 'b'])).not.toBe(calcularPoolHash(['a', 'b', 'c']))
    })

    it('devuelve un SHA-256 en hexadecimal', () => {
        expect(calcularPoolHash(['a'])).toMatch(/^[0-9a-f]{64}$/)
    })
})

describe('seleccionarGanadores', () => {
    it('devuelve exactamente la cantidad pedida', () => {
        const r = seleccionarGanadores(pool(50), 5, 'semilla-fija')
        expect(r.ganadores).toHaveLength(5)
        expect(r.ganadoresInsuficientes).toBe(false)
    })

    it('es reproducible: misma semilla, mismos ganadores', () => {
        const p = pool(50)
        const a = seleccionarGanadores(p, 5, 'semilla-fija')
        const b = seleccionarGanadores(p, 5, 'semilla-fija')
        expect(a.ganadores.map(g => g.id)).toEqual(b.ganadores.map(g => g.id))
        expect(a.orden).toEqual(b.orden)
    })

    it('cambia el resultado con otra semilla', () => {
        const p = pool(50)
        const a = seleccionarGanadores(p, 5, 'semilla-A')
        const b = seleccionarGanadores(p, 5, 'semilla-B')
        expect(a.ganadores.map(g => g.id)).not.toEqual(b.ganadores.map(g => g.id))
    })

    it('no depende del orden en que llegue el pool', () => {
        // Determinismo real: el resultado se ancla al número de boleto, no a
        // cómo la base de datos devolvió las filas.
        const p = pool(30)
        const desordenado = [...p].reverse()
        const a = seleccionarGanadores(p, 4, 'semilla-fija')
        const b = seleccionarGanadores(desordenado, 4, 'semilla-fija')
        expect(a.ganadores.map(g => g.id)).toEqual(b.ganadores.map(g => g.id))
    })

    it('nunca premia dos veces al mismo cliente', () => {
        // 10 clientes con 20 boletos cada uno: sin la regla, habría repetidos
        const r = seleccionarGanadores(pool(10, 20), 10, 'semilla-fija')
        const clientes = r.ganadores.map(g => g.cliente_id)
        expect(new Set(clientes).size).toBe(clientes.length)
    })

    it('avisa cuando hay menos clientes distintos que premios', () => {
        const r = seleccionarGanadores(pool(3, 10), 5, 'semilla-fija')
        expect(r.ganadores).toHaveLength(3)
        expect(r.ganadoresInsuficientes).toBe(true)
    })

    it('maneja un pool vacío sin lanzar', () => {
        const r = seleccionarGanadores([], 3, 'semilla-fija')
        expect(r.ganadores).toEqual([])
        expect(r.poolCount).toBe(0)
        expect(r.ganadoresInsuficientes).toBe(true)
    })

    it('registra el orden de todos los participantes exactamente una vez', () => {
        const p = pool(20)
        const r = seleccionarGanadores(p, 3, 'semilla-fija')

        expect(r.orden).toHaveLength(20)
        expect(new Set(r.orden.map(o => o.ticketId)).size).toBe(20)
        expect([...r.orden.map(o => o.orden)].sort((a, b) => a - b))
            .toEqual(Array.from({ length: 20 }, (_, i) => i))
    })

    it('los ganadores son los primeros elegibles del barajado', () => {
        const p = pool(20)
        const r = seleccionarGanadores(p, 3, 'semilla-fija')

        const posiciones = new Map(r.orden.map(o => [o.ticketId, o.orden]))
        const posGanadores = r.ganadores.map(g => posiciones.get(g.id)!)

        // Están en orden ascendente de posición
        expect(posGanadores).toEqual([...posGanadores].sort((a, b) => a - b))
    })

    it('calcula el hash y el conteo del pool', () => {
        const p = pool(15)
        const r = seleccionarGanadores(p, 2, 'semilla-fija')
        expect(r.poolCount).toBe(15)
        expect(r.poolHash).toBe(calcularPoolHash(p.map(t => t.id)))
    })

    it('rechaza una cantidad de ganadores no positiva', () => {
        expect(() => seleccionarGanadores(pool(10), 0, 's')).toThrow()
        expect(() => seleccionarGanadores(pool(10), -1, 's')).toThrow()
    })

    it('rechaza una semilla vacía', () => {
        expect(() => seleccionarGanadores(pool(10), 1, '')).toThrow()
    })
})
```

- [ ] **Paso 2: Ejecutar y confirmar que falla**

Ejecuta: `npm test -- sorteo`
Esperado: FALLA con error de resolución de `./sorteo`.

- [ ] **Paso 3: Implementar el algoritmo**

Crea `lib/utils/sorteo.ts`:

```ts
import crypto from 'node:crypto'

/**
 * Selección de ganadores de sorteo, determinista y reproducible.
 *
 * Todo aquí es una función pura: mismos argumentos, mismo resultado, siempre.
 * Esa es la propiedad que permite guardar la semilla y volver a demostrar
 * meses después que los ganadores salieron de un barajado limpio.
 *
 * NUNCA introduzcas Math.random() ni Date.now() en este archivo.
 */

/** Versión del algoritmo. Se guarda en cada ejecución para poder verificarla. */
export const ALGORITMO_SORTEO = 'mulberry32-fisher-yates-v1'

export interface TicketParticipante {
    id: string
    numero: number
    cliente_id: string
}

export interface ResultadoSorteo {
    ganadores: TicketParticipante[]
    /** Posición de cada boleto tras el barajado. Se persiste para auditoría. */
    orden: { ticketId: string; orden: number }[]
    poolCount: number
    poolHash: string
    /** true si no había clientes distintos suficientes para todos los premios. */
    ganadoresInsuficientes: boolean
}

/** Convierte un texto en un entero de 32 bits (xmur3). */
export function xmur3(texto: string): () => number {
    let h = 1779033703 ^ texto.length
    for (let i = 0; i < texto.length; i++) {
        h = Math.imul(h ^ texto.charCodeAt(i), 3432918353)
        h = (h << 13) | (h >>> 19)
    }
    return function () {
        h = Math.imul(h ^ (h >>> 16), 2246822507)
        h = Math.imul(h ^ (h >>> 13), 3266489909)
        h ^= h >>> 16
        return h >>> 0
    }
}

export function hashSemilla(texto: string): number {
    return xmur3(texto)()
}

/** Generador pseudoaleatorio con semilla. Devuelve valores en [0, 1). */
export function mulberry32(semilla: number): () => number {
    let a = semilla >>> 0
    return function () {
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** Fisher-Yates alimentado por el generador dado. No muta la entrada. */
export function barajarDeterminista<T>(items: readonly T[], rng: () => number): T[] {
    const copia = [...items]
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        const tmp = copia[i]
        copia[i] = copia[j]
        copia[j] = tmp
    }
    return copia
}

/**
 * Huella del conjunto de participantes, independiente del orden de entrada.
 * Sirve para detectar si el pool cambió después de ejecutar el sorteo
 * (por ejemplo, porque se anuló un boleto).
 */
export function calcularPoolHash(ids: readonly string[]): string {
    return crypto
        .createHash('sha256')
        .update([...ids].sort().join(','))
        .digest('hex')
}

/**
 * Elige `cantidad` boletos ganadores del pool.
 *
 * El pool se ordena por número de boleto antes de barajar, así el resultado
 * no depende del orden en que la base de datos haya devuelto las filas.
 * Después se recorre el barajado saltando los clientes que ya ganaron, hasta
 * completar los premios o agotar el pool.
 */
export function seleccionarGanadores(
    pool: readonly TicketParticipante[],
    cantidad: number,
    semilla: string,
): ResultadoSorteo {
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
        throw new Error('La cantidad de ganadores debe ser un entero positivo')
    }
    if (!semilla || !semilla.trim()) {
        throw new Error('La semilla no puede estar vacía')
    }

    const poolHash = calcularPoolHash(pool.map(t => t.id))

    if (pool.length === 0) {
        return {
            ganadores: [],
            orden: [],
            poolCount: 0,
            poolHash,
            ganadoresInsuficientes: true,
        }
    }

    // Orden canónico: sin esto, el resultado dependería del ORDER BY de la consulta
    const ordenado = [...pool].sort((a, b) => a.numero - b.numero)

    const barajado = barajarDeterminista(ordenado, mulberry32(hashSemilla(semilla)))

    const ganadores: TicketParticipante[] = []
    const clientesPremiados = new Set<string>()

    for (const boleto of barajado) {
        if (ganadores.length >= cantidad) break
        if (clientesPremiados.has(boleto.cliente_id)) continue
        ganadores.push(boleto)
        clientesPremiados.add(boleto.cliente_id)
    }

    return {
        ganadores,
        orden: barajado.map((t, i) => ({ ticketId: t.id, orden: i })),
        poolCount: pool.length,
        poolHash,
        ganadoresInsuficientes: ganadores.length < cantidad,
    }
}
```

- [ ] **Paso 4: Ejecutar las pruebas y confirmar que pasan**

Ejecuta: `npm test -- sorteo`
Esperado: 24 pruebas en verde.

- [ ] **Paso 5: Commit**

```bash
git add lib/utils/sorteo.ts lib/utils/sorteo.test.ts
git commit -m "feat: algoritmo determinista y reproducible de selección de ganadores"
```

---

## Tarea 2: Persistencia atómica de la ejecución

**Files:**
- Create: `supabase/migrations/20260729_07_ejecutar_sorteo.sql`
- Create: `supabase/tests/ejecutar_sorteo.sql`

**Interfaces:**
- Consumes: tablas de sorteo (Plan 1, Tarea 2)
- Produces: RPC `guardar_ejecucion_sorteo(...) RETURNS JSONB`

- [ ] **Paso 1: Escribir el guion de verificación**

Crea `supabase/tests/ejecutar_sorteo.sql`:

```sql
-- ══════════════════════════════════════════════════════════════
-- Verificación manual de guardar_ejecucion_sorteo
-- Todo dentro de una transacción que termina en ROLLBACK.
-- ══════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  v_cliente1 UUID;
  v_cliente2 UUID;
  v_sorteo   UUID;
  v_t1       UUID;
  v_t2       UUID;
  v_res      JSONB;
  v_ejec1    UUID;
  v_conteo   INTEGER;
BEGIN
  INSERT INTO public.clientes (nombre, apellido, telefono)
  VALUES ('SorteoUno', 'Prueba', '8090000001') RETURNING id INTO v_cliente1;
  INSERT INTO public.clientes (nombre, apellido, telefono)
  VALUES ('SorteoDos', 'Prueba', '8090000002') RETURNING id INTO v_cliente2;

  INSERT INTO public.sorteos (nombre, fecha_inicio, fecha_fin, estado, prefijo)
  VALUES ('Sorteo Verificacion', CURRENT_DATE - 10, CURRENT_DATE + 10, 'borrador', 'TSTVER')
  RETURNING id INTO v_sorteo;

  INSERT INTO public.tickets
    (numero, numero_formateado, sorteo_id, cliente_id, origen, token_publico, snapshot)
  VALUES (1, 'TSTVER-000001', v_sorteo, v_cliente1, 'manual', 'tok-ver-1', '{}'::jsonb)
  RETURNING id INTO v_t1;

  INSERT INTO public.tickets
    (numero, numero_formateado, sorteo_id, cliente_id, origen, token_publico, snapshot)
  VALUES (2, 'TSTVER-000002', v_sorteo, v_cliente2, 'manual', 'tok-ver-2', '{}'::jsonb)
  RETURNING id INTO v_t2;

  -- Caso 1: primera ejecución
  v_res := public.guardar_ejecucion_sorteo(
    v_sorteo, CURRENT_DATE - 10, CURRENT_DATE + 10, 1,
    'semilla-uno', 'mulberry32-fisher-yates-v1', 'hash-uno', 2,
    jsonb_build_array(
      jsonb_build_object('ticket_id', v_t1, 'orden', 0),
      jsonb_build_object('ticket_id', v_t2, 'orden', 1)
    ),
    jsonb_build_array(
      jsonb_build_object('ticket_id', v_t1, 'cliente_id', v_cliente1,
                         'posicion', 1, 'premio', 'Primer premio',
                         'snapshot', '{}'::jsonb)
    ),
    NULL
  );

  ASSERT (v_res ->> 'ok')::BOOLEAN, 'Caso 1: debió guardar la ejecución';
  v_ejec1 := (v_res ->> 'ejecucion_id')::UUID;

  SELECT count(*) INTO v_conteo
  FROM public.sorteo_participantes WHERE ejecucion_id = v_ejec1;
  ASSERT v_conteo = 2, 'Caso 1: debieron guardarse 2 participantes';

  SELECT count(*) INTO v_conteo
  FROM public.sorteo_ganadores WHERE ejecucion_id = v_ejec1;
  ASSERT v_conteo = 1, 'Caso 1: debió guardarse 1 ganador';

  ASSERT (SELECT vigente FROM public.sorteo_ejecuciones WHERE id = v_ejec1),
         'Caso 1: la ejecución debe quedar vigente';

  -- Caso 2: re-ejecutar desplaza la anterior sin borrarla
  v_res := public.guardar_ejecucion_sorteo(
    v_sorteo, CURRENT_DATE - 10, CURRENT_DATE + 10, 1,
    'semilla-dos', 'mulberry32-fisher-yates-v1', 'hash-dos', 2,
    jsonb_build_array(
      jsonb_build_object('ticket_id', v_t2, 'orden', 0),
      jsonb_build_object('ticket_id', v_t1, 'orden', 1)
    ),
    jsonb_build_array(
      jsonb_build_object('ticket_id', v_t2, 'cliente_id', v_cliente2,
                         'posicion', 1, 'premio', 'Primer premio',
                         'snapshot', '{}'::jsonb)
    ),
    NULL
  );

  ASSERT (v_res ->> 'ok')::BOOLEAN, 'Caso 2: debió guardar la segunda ejecución';

  ASSERT NOT (SELECT vigente FROM public.sorteo_ejecuciones WHERE id = v_ejec1),
         'Caso 2: la ejecución anterior debe dejar de ser vigente';

  SELECT count(*) INTO v_conteo
  FROM public.sorteo_ejecuciones WHERE sorteo_id = v_sorteo;
  ASSERT v_conteo = 2, 'Caso 2: ambas ejecuciones deben conservarse';

  SELECT count(*) INTO v_conteo
  FROM public.sorteo_ganadores WHERE ejecucion_id = v_ejec1;
  ASSERT v_conteo = 1, 'Caso 2: los ganadores antiguos se conservan para auditoría';

  -- Caso 3: un sorteo cerrado no admite ejecuciones
  UPDATE public.sorteos SET estado = 'cerrado' WHERE id = v_sorteo;

  v_res := public.guardar_ejecucion_sorteo(
    v_sorteo, CURRENT_DATE - 10, CURRENT_DATE + 10, 1,
    'semilla-tres', 'mulberry32-fisher-yates-v1', 'hash-tres', 2,
    '[]'::jsonb, '[]'::jsonb, NULL
  );

  ASSERT NOT (v_res ->> 'ok')::BOOLEAN, 'Caso 3: un sorteo cerrado debe rechazarse';

  RAISE NOTICE 'TODAS LAS VERIFICACIONES PASARON';
END $$;

ROLLBACK;
```

- [ ] **Paso 2: Ejecutar y confirmar que falla**

Ejecuta el guion en Supabase Studio.
Esperado: FALLA con `function public.guardar_ejecucion_sorteo(...) does not exist`.

- [ ] **Paso 3: Escribir la migración**

Crea `supabase/migrations/20260729_07_ejecutar_sorteo.sql`:

```sql
-- ══════════════════════════════════════════════════════════════
-- Migración: persistencia atómica de una ejecución de sorteo
--
-- El barajado se calcula en TypeScript (lib/utils/sorteo.ts), que es donde
-- vive la única implementación del algoritmo. Este RPC solo guarda el
-- resultado, de forma que una ejecución nunca quede a medias: o se registra
-- entera, o no se registra.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guardar_ejecucion_sorteo(
    p_sorteo_id     UUID,
    p_rango_desde   DATE,
    p_rango_hasta   DATE,
    p_cantidad      INTEGER,
    p_semilla       TEXT,
    p_algoritmo     TEXT,
    p_pool_hash     TEXT,
    p_pool_count    INTEGER,
    p_participantes JSONB,   -- [{ ticket_id, orden }]
    p_ganadores     JSONB,   -- [{ ticket_id, cliente_id, posicion, premio, snapshot }]
    p_ejecutado_por UUID
)
RETURNS JSONB AS $$
DECLARE
    v_sorteo   public.sorteos%ROWTYPE;
    v_ejecucion UUID;
BEGIN
    SELECT * INTO v_sorteo FROM public.sorteos WHERE id = p_sorteo_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sorteo no encontrado');
    END IF;

    IF v_sorteo.estado = 'cerrado' THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'El sorteo está cerrado y no admite nuevas ejecuciones');
    END IF;

    IF p_cantidad <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'La cantidad de ganadores debe ser mayor que cero');
    END IF;

    -- La ejecución anterior deja de ser vigente, pero se conserva entera.
    UPDATE public.sorteo_ejecuciones
       SET vigente = FALSE
     WHERE sorteo_id = p_sorteo_id AND vigente;

    INSERT INTO public.sorteo_ejecuciones (
        sorteo_id, rango_desde, rango_hasta, cantidad_ganadores,
        semilla, algoritmo, pool_count, pool_hash, vigente, ejecutado_por
    ) VALUES (
        p_sorteo_id, p_rango_desde, p_rango_hasta, p_cantidad,
        p_semilla, p_algoritmo, p_pool_count, p_pool_hash, TRUE, p_ejecutado_por
    ) RETURNING id INTO v_ejecucion;

    INSERT INTO public.sorteo_participantes (ejecucion_id, ticket_id, orden)
    SELECT v_ejecucion,
           (elem ->> 'ticket_id')::UUID,
           (elem ->> 'orden')::INTEGER
      FROM jsonb_array_elements(p_participantes) AS elem;

    INSERT INTO public.sorteo_ganadores
        (ejecucion_id, ticket_id, cliente_id, posicion, premio, snapshot)
    SELECT v_ejecucion,
           (elem ->> 'ticket_id')::UUID,
           (elem ->> 'cliente_id')::UUID,
           (elem ->> 'posicion')::INTEGER,
           elem ->> 'premio',
           COALESCE(elem -> 'snapshot', '{}'::jsonb)
      FROM jsonb_array_elements(p_ganadores) AS elem;

    IF v_sorteo.estado = 'borrador' THEN
        UPDATE public.sorteos SET estado = 'activo' WHERE id = p_sorteo_id
          AND NOT EXISTS (
            SELECT 1 FROM public.sorteos WHERE estado = 'activo' AND id <> p_sorteo_id
          );
    END IF;

    RETURN jsonb_build_object('ok', true, 'ejecucion_id', v_ejecucion);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

- [ ] **Paso 4: Aplicar y ejecutar el guion**

Ejecuta la migración, luego `supabase/tests/ejecutar_sorteo.sql`.
Esperado: `NOTICE: TODAS LAS VERIFICACIONES PASARON`.

- [ ] **Paso 5: Commit**

```bash
git add supabase/migrations/20260729_07_ejecutar_sorteo.sql supabase/tests/ejecutar_sorteo.sql
git commit -m "feat: persistencia atómica de las ejecuciones de sorteo"
```

---

## Tarea 3: Server Actions de sorteos

**Files:**
- Create: `lib/validations/sorteos.ts`
- Create: `lib/actions/sorteos.ts`
- Modify: `lib/actions/tickets.ts`

**Interfaces:**
- Consumes: `seleccionarGanadores`, `calcularPoolHash`, `ALGORITMO_SORTEO` (Tarea 1); RPC `guardar_ejecucion_sorteo` (Tarea 2); `rangoRDaUTC` (Plan 1, Tarea 1)
- Produces:
  - `getSorteos()`, `getSorteoDetalle(id)`
  - `crearSorteo(input)`, `actualizarSorteo(id, input)`
  - `activarSorteo(id)`, `cerrarSorteo(id)`
  - `previsualizarPool(sorteoId, desde, hasta): Promise<{ boletos: number; clientes: number }>`
  - `ejecutarSorteo(input): Promise<{ ejecucionId: string; ganadoresInsuficientes: boolean }>`
  - `verificarEjecucion(ejecucionId): Promise<ResultadoVerificacion>`
  - `marcarPremioEntregado(ganadorId, entregado)`
  - `asignarTicketsASorteo(ticketIds, sorteoId)`

- [ ] **Paso 1: Crear los esquemas de validación**

Crea `lib/validations/sorteos.ts`:

```ts
import { z } from 'zod'

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')

export const SorteoSchema = z.object({
    nombre: z.string().trim().min(3, 'El nombre debe tener al menos 3 caracteres').max(120),
    descripcion: z.string().trim().max(500).optional().nullable(),
    premio: z.string().trim().max(200).optional().nullable(),
    fecha_inicio: FECHA,
    fecha_fin: FECHA,
    prefijo: z.string().trim().min(2).max(12)
        .regex(/^[A-Z0-9]+$/, 'El prefijo solo admite mayúsculas y números'),
    cantidad_ganadores_default: z.number().int().min(1).max(100),
}).refine(d => d.fecha_fin >= d.fecha_inicio, {
    message: 'La fecha final no puede ser anterior a la inicial',
    path: ['fecha_fin'],
})

export type SorteoFormData = z.infer<typeof SorteoSchema>

export const EjecutarSorteoSchema = z.object({
    sorteo_id: z.string().uuid(),
    rango_desde: FECHA,
    rango_hasta: FECHA,
    cantidad_ganadores: z.number().int().min(1).max(100),
    semilla: z.string().trim().max(120).optional(),
    notas: z.string().trim().max(300).optional(),
}).refine(d => d.rango_hasta >= d.rango_desde, {
    message: 'La fecha final no puede ser anterior a la inicial',
    path: ['rango_hasta'],
})

export type EjecutarSorteoFormData = z.infer<typeof EjecutarSorteoSchema>
```

- [ ] **Paso 2: Crear las Server Actions**

Crea `lib/actions/sorteos.ts`:

```ts
'use server'

import crypto from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getPermisos } from '@/lib/utils/permisos'
import { rangoRDaUTC } from '@/lib/utils/fecha-rd'
import {
    seleccionarGanadores,
    calcularPoolHash,
    ALGORITMO_SORTEO,
    type TicketParticipante,
} from '@/lib/utils/sorteo'
import {
    SorteoSchema, EjecutarSorteoSchema,
    type SorteoFormData, type EjecutarSorteoFormData,
} from '@/lib/validations/sorteos'
import type { Sorteo } from '@/lib/types'

async function contexto() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: perfil } = await supabase
        .from('profiles').select('id, rol, permisos').eq('id', user.id).single()
    if (!perfil) throw new Error('Perfil no encontrado')

    return { supabase, user, permisos: getPermisos(perfil) }
}

async function exigirPermisoSorteo() {
    const ctx = await contexto()
    if (!ctx.permisos.realizar_sorteo) {
        throw new Error('No tienes permiso para gestionar sorteos')
    }
    return ctx
}

// ─── CRUD ─────────────────────────────────────────────────────

export async function getSorteos(): Promise<Sorteo[]> {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('sorteos').select('*').order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []) as Sorteo[]
}

export async function getSorteoDetalle(id: string) {
    const supabase = await createClient()

    const { data: sorteo, error } = await supabase
        .from('sorteos').select('*').eq('id', id).single()
    if (error || !sorteo) throw new Error('Sorteo no encontrado')

    const { data: ejecuciones } = await supabase
        .from('sorteo_ejecuciones')
        .select('*, ejecutor:profiles(id, full_name)')
        .eq('sorteo_id', id)
        .order('ejecutado_at', { ascending: false })

    const vigente = ejecuciones?.find(e => e.vigente) ?? null

    const ganadores = vigente
        ? (await supabase
            .from('sorteo_ganadores')
            .select('*, ticket:tickets(id, numero_formateado, estado), cliente:clientes(id, nombre, apellido, telefono)')
            .eq('ejecucion_id', vigente.id)
            .order('posicion')
          ).data ?? []
        : []

    const { count: totalBoletos } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('sorteo_id', id)
        .eq('estado', 'valido')

    return {
        sorteo: sorteo as Sorteo,
        ejecuciones: ejecuciones ?? [],
        ejecucionVigente: vigente,
        ganadores,
        totalBoletos: totalBoletos ?? 0,
    }
}

export async function crearSorteo(input: SorteoFormData): Promise<Sorteo> {
    const { supabase, user } = await exigirPermisoSorteo()
    const validado = SorteoSchema.parse(input)

    const { data, error } = await supabase
        .from('sorteos')
        .insert({ ...validado, creado_por: user.id })
        .select()
        .single()

    if (error) {
        if (error.code === '23505') {
            throw new Error('Ya existe un sorteo con ese prefijo')
        }
        throw new Error(error.message)
    }

    revalidatePath('/sorteos')
    return data as Sorteo
}

export async function actualizarSorteo(
    id: string, input: SorteoFormData,
): Promise<void> {
    const { supabase } = await exigirPermisoSorteo()
    const validado = SorteoSchema.parse(input)

    const { error } = await supabase.from('sorteos').update(validado).eq('id', id)
    if (error) throw new Error(error.message)

    revalidatePath('/sorteos')
    revalidatePath(`/sorteos/${id}`)
}

/** Activa un sorteo. Solo puede haber uno activo: el anterior pasa a borrador. */
export async function activarSorteo(id: string): Promise<void> {
    const { supabase } = await exigirPermisoSorteo()

    const { data: sorteo } = await supabase
        .from('sorteos').select('estado').eq('id', id).single()

    if (sorteo?.estado === 'cerrado') {
        throw new Error('Un sorteo cerrado no se puede reactivar')
    }

    // El índice único uq_sorteo_activo impide dos activos a la vez
    await supabase
        .from('sorteos').update({ estado: 'borrador' })
        .eq('estado', 'activo').neq('id', id)

    const { error } = await supabase
        .from('sorteos').update({ estado: 'activo' }).eq('id', id)

    if (error) throw new Error(error.message)

    revalidatePath('/sorteos')
    revalidatePath(`/sorteos/${id}`)
}

/** Sella el sorteo: no admite más ejecuciones ni boletos nuevos. */
export async function cerrarSorteo(id: string): Promise<void> {
    const { supabase } = await exigirPermisoSorteo()

    const { error } = await supabase
        .from('sorteos').update({ estado: 'cerrado' }).eq('id', id)

    if (error) throw new Error(error.message)

    revalidatePath('/sorteos')
    revalidatePath(`/sorteos/${id}`)
}

// ─── POOL Y EJECUCIÓN ─────────────────────────────────────────

/** Lee los boletos que participarían, en orden canónico por número. */
async function leerPool(
    supabase: Awaited<ReturnType<typeof createClient>>,
    sorteoId: string,
    desde: string,
    hasta: string,
): Promise<TicketParticipante[]> {
    const { desdeISO, hastaISO } = rangoRDaUTC(desde, hasta)

    const { data, error } = await supabase
        .from('tickets')
        .select('id, numero, cliente_id')
        .eq('sorteo_id', sorteoId)
        .eq('estado', 'valido')
        .gte('emitido_at', desdeISO)
        .lte('emitido_at', hastaISO)
        .order('numero')

    if (error) throw new Error(error.message)
    return (data ?? []) as TicketParticipante[]
}

/** Cuántos boletos y cuántos clientes distintos participarían. */
export async function previsualizarPool(
    sorteoId: string, desde: string, hasta: string,
): Promise<{ boletos: number; clientes: number }> {
    const supabase = await createClient()
    const pool = await leerPool(supabase, sorteoId, desde, hasta)

    return {
        boletos: pool.length,
        clientes: new Set(pool.map(t => t.cliente_id)).size,
    }
}

/**
 * Ejecuta el sorteo.
 *
 * El barajado se calcula aquí, en TypeScript, con la función pura probada en
 * lib/utils/sorteo.ts. El RPC solo persiste el resultado, de forma atómica.
 */
export async function ejecutarSorteo(
    input: EjecutarSorteoFormData,
): Promise<{ ejecucionId: string; ganadoresInsuficientes: boolean; poolCount: number }> {
    const { supabase, user } = await exigirPermisoSorteo()
    const validado = EjecutarSorteoSchema.parse(input)

    const { data: sorteo } = await supabase
        .from('sorteos').select('*').eq('id', validado.sorteo_id).single()
    if (!sorteo) throw new Error('Sorteo no encontrado')
    if (sorteo.estado === 'cerrado') {
        throw new Error('El sorteo está cerrado y no admite nuevas ejecuciones')
    }

    const pool = await leerPool(
        supabase, validado.sorteo_id, validado.rango_desde, validado.rango_hasta,
    )

    if (pool.length === 0) {
        throw new Error('No hay boletos válidos en ese rango de fechas')
    }

    // Semilla aleatoria criptográfica si el usuario no fija una propia.
    // Se guarda tal cual, y es lo que hace el sorteo reproducible.
    const semilla = validado.semilla?.trim() || crypto.randomUUID()

    const resultado = seleccionarGanadores(pool, validado.cantidad_ganadores, semilla)

    const ganadores = resultado.ganadores.map((t, i) => ({
        ticket_id: t.id,
        cliente_id: t.cliente_id,
        posicion: i + 1,
        premio: sorteo.premio ?? null,
        snapshot: { numero: t.numero, elegido_en_posicion: i + 1 },
    }))

    const { data, error } = await supabase.rpc('guardar_ejecucion_sorteo', {
        p_sorteo_id: validado.sorteo_id,
        p_rango_desde: validado.rango_desde,
        p_rango_hasta: validado.rango_hasta,
        p_cantidad: validado.cantidad_ganadores,
        p_semilla: semilla,
        p_algoritmo: ALGORITMO_SORTEO,
        p_pool_hash: resultado.poolHash,
        p_pool_count: resultado.poolCount,
        p_participantes: resultado.orden.map(o => ({
            ticket_id: o.ticketId, orden: o.orden,
        })),
        p_ganadores: ganadores,
        p_ejecutado_por: user.id,
    })

    if (error) throw new Error(error.message)
    if (!data?.ok) throw new Error(data?.error ?? 'No se pudo guardar la ejecución')

    revalidatePath('/sorteos')
    revalidatePath(`/sorteos/${validado.sorteo_id}`)

    return {
        ejecucionId: data.ejecucion_id as string,
        ganadoresInsuficientes: resultado.ganadoresInsuficientes,
        poolCount: resultado.poolCount,
    }
}

// ─── VERIFICACIÓN ─────────────────────────────────────────────

export interface ResultadoVerificacion {
    coincide: boolean
    algoritmo: string
    semilla: string
    poolCount: number
    poolIntacto: boolean
    mensaje: string
    ganadoresEsperados: string[]
    ganadoresGuardados: string[]
}

/**
 * Reconstruye el sorteo desde la semilla y los participantes almacenados y
 * comprueba que salgan los mismos ganadores.
 *
 * También compara el hash del pool contra el conjunto de participantes
 * guardado: si alguien anuló un boleto después del sorteo, se detecta.
 */
export async function verificarEjecucion(
    ejecucionId: string,
): Promise<ResultadoVerificacion> {
    const { supabase } = await contexto()

    const { data: ejecucion, error } = await supabase
        .from('sorteo_ejecuciones').select('*').eq('id', ejecucionId).single()

    if (error || !ejecucion) throw new Error('Ejecución no encontrada')

    if (ejecucion.algoritmo !== ALGORITMO_SORTEO) {
        return {
            coincide: false,
            algoritmo: ejecucion.algoritmo,
            semilla: ejecucion.semilla,
            poolCount: ejecucion.pool_count,
            poolIntacto: false,
            mensaje: `Esta ejecución usó el algoritmo "${ejecucion.algoritmo}" y el sistema actual usa "${ALGORITMO_SORTEO}". No se puede verificar automáticamente.`,
            ganadoresEsperados: [],
            ganadoresGuardados: [],
        }
    }

    const { data: participantes } = await supabase
        .from('sorteo_participantes')
        .select('ticket_id, ticket:tickets(id, numero, cliente_id)')
        .eq('ejecucion_id', ejecucionId)

    const pool: TicketParticipante[] = (participantes ?? [])
        .map(p => p.ticket as unknown as TicketParticipante)
        .filter(Boolean)

    const { data: guardados } = await supabase
        .from('sorteo_ganadores')
        .select('ticket_id, posicion, ticket:tickets(numero_formateado)')
        .eq('ejecucion_id', ejecucionId)
        .order('posicion')

    const recalculado = seleccionarGanadores(
        pool, ejecucion.cantidad_ganadores, ejecucion.semilla,
    )

    const esperados = recalculado.ganadores.map(g => g.id)
    const almacenados = (guardados ?? []).map(g => g.ticket_id)

    const coincide =
        esperados.length === almacenados.length &&
        esperados.every((id, i) => id === almacenados[i])

    const poolIntacto = calcularPoolHash(pool.map(t => t.id)) === ejecucion.pool_hash

    let mensaje: string
    if (coincide && poolIntacto) {
        mensaje = 'Verificado. Al repetir el sorteo con la misma semilla salen exactamente los mismos ganadores.'
    } else if (coincide && !poolIntacto) {
        mensaje = 'Los ganadores coinciden, pero la lista de participantes guardada ya no cuadra con la huella original. Es probable que algún boleto se haya eliminado de la base de datos.'
    } else {
        mensaje = 'Los ganadores NO coinciden con lo que produce el algoritmo a partir de la semilla guardada. Revisa esta ejecución.'
    }

    return {
        coincide,
        algoritmo: ejecucion.algoritmo,
        semilla: ejecucion.semilla,
        poolCount: ejecucion.pool_count,
        poolIntacto,
        mensaje,
        ganadoresEsperados: esperados,
        ganadoresGuardados: almacenados,
    }
}

// ─── PREMIOS ──────────────────────────────────────────────────

export async function marcarPremioEntregado(
    ganadorId: string, entregado: boolean, notas?: string,
): Promise<void> {
    const { supabase } = await exigirPermisoSorteo()

    const { data: ganador } = await supabase
        .from('sorteo_ganadores')
        .select('ejecucion_id, ejecucion:sorteo_ejecuciones(sorteo_id)')
        .eq('id', ganadorId)
        .single()

    const { error } = await supabase
        .from('sorteo_ganadores')
        .update({
            entregado,
            entregado_at: entregado ? new Date().toISOString() : null,
            notas: notas?.trim() || null,
        })
        .eq('id', ganadorId)

    if (error) throw new Error(error.message)

    const sorteoId = (ganador?.ejecucion as unknown as { sorteo_id: string } | null)?.sorteo_id
    if (sorteoId) revalidatePath(`/sorteos/${sorteoId}`)
}
```

- [ ] **Paso 3: Añadir la asignación de boletos huérfanos**

Añade a `lib/actions/tickets.ts`:

```ts
/**
 * Asigna boletos sin sorteo a un sorteo concreto.
 *
 * No se renumeran: conservan su `numero_formateado` original, porque puede
 * haberse impreso o enviado ya al cliente.
 */
export async function asignarTicketsASorteo(
    ticketIds: string[],
    sorteoId: string,
): Promise<{ asignados: number }> {
    const { supabase, user, permisos } = await perfilActual()

    if (!permisos.realizar_sorteo) {
        throw new Error('No tienes permiso para asignar boletos a un sorteo')
    }
    if (ticketIds.length === 0) return { asignados: 0 }

    const { data: sorteo } = await supabase
        .from('sorteos').select('id, nombre, estado').eq('id', sorteoId).single()

    if (!sorteo) throw new Error('Sorteo no encontrado')
    if (sorteo.estado === 'cerrado') {
        throw new Error('El sorteo está cerrado')
    }

    const { data, error } = await supabase
        .from('tickets')
        .update({ sorteo_id: sorteoId })
        .in('id', ticketIds)
        .is('sorteo_id', null)          // solo huérfanos, nunca robar de otro sorteo
        .eq('estado', 'valido')
        .select('id')

    if (error) throw new Error(error.message)

    const asignados = data?.length ?? 0

    if (asignados > 0) {
        await supabase.from('ticket_eventos').insert(
            data!.map(t => ({
                ticket_id: t.id,
                tipo: 'asignado_sorteo' as const,
                estado: 'ok' as const,
                detalle: `Asignado al sorteo "${sorteo.nombre}"`,
                usuario_id: user.id,
            })),
        )
    }

    revalidatePath('/tickets')
    revalidatePath(`/sorteos/${sorteoId}`)

    return { asignados }
}
```

- [ ] **Paso 4: Verificar**

Ejecuta: `npm test && npx tsc --noEmit`
Esperado: todo en verde.

- [ ] **Paso 5: Commit**

```bash
git add lib/actions/sorteos.ts lib/validations/sorteos.ts lib/actions/tickets.ts
git commit -m "feat: acciones de sorteo, ejecución y verificación"
```

---

## Tarea 4: Interfaz de sorteos

**Files:**
- Create: `components/sorteos/sorteos-view.tsx`
- Create: `components/sorteos/sorteo-form-dialog.tsx`
- Create: `components/sorteos/ejecutar-sorteo-dialog.tsx`
- Create: `components/sorteos/ganadores-panel.tsx`
- Create: `app/(dashboard)/sorteos/page.tsx`
- Create: `app/(dashboard)/sorteos/[id]/page.tsx`
- Modify: `components/tickets/tickets-view.tsx`

**Interfaces:**
- Consumes: todas las acciones de la Tarea 3
- Produces: las pantallas de sorteo

- [ ] **Paso 1: Crear el listado**

Crea `components/sorteos/sorteos-view.tsx`, componente de cliente que recibe
`sorteos: Sorteo[]` y `puedeGestionar: boolean`.

Renderiza una tarjeta por sorteo, siguiendo el patrón visual de
`components/tiendas/tiendas-referidas-view.tsx`. Cada tarjeta muestra nombre, premio, rango
de fechas (`fecha_inicio` – `fecha_fin`), un distintivo de estado con
`ESTADO_SORTEO_LABELS`, y el prefijo con el correlativo actual
(`{prefijo} · {ultimo_numero} boletos emitidos`). Enlaza a `/sorteos/{id}`.

Botón "Nuevo sorteo" arriba, visible solo con `puedeGestionar`, que abre
`<SorteoFormDialog />`.

Destaca visualmente el sorteo `activo`: es el que recibe los boletos nuevos, y confundirse
con eso es el error más caro del módulo.

- [ ] **Paso 2: Crear el formulario**

Crea `components/sorteos/sorteo-form-dialog.tsx` con `react-hook-form` y
`zodResolver(SorteoSchema)`, siguiendo el patrón de `components/clientes/cliente-form.tsx`.

Campos: `nombre`, `descripcion` (textarea), `premio`, `fecha_inicio`, `fecha_fin`
(`<Input type="date">`), `prefijo` y `cantidad_ganadores_default`.

Bajo el campo de prefijo, esta ayuda:

> Los boletos de este sorteo se numerarán como `PREFIJO-000001`. Debe ser único y no se puede
> cambiar una vez emitido el primer boleto.

- [ ] **Paso 3: Crear el diálogo de ejecución**

Crea `components/sorteos/ejecutar-sorteo-dialog.tsx`.

Props: `{ abierto, onCerrar, sorteo: Sorteo, hayEjecucionPrevia: boolean }`.

Campos: `rango_desde` y `rango_hasta` (por defecto, las fechas del sorteo),
`cantidad_ganadores` (por defecto `cantidad_ganadores_default`), y un campo opcional de
semilla dentro de un desplegable "Opciones avanzadas", con la ayuda:

> Déjalo vacío para que el sistema genere una semilla aleatoria. Rellénalo solo si quieres
> repetir un sorteo anterior exactamente igual.

**Vista previa del pool.** Cada vez que cambien las fechas, llama a `previsualizarPool` y
muestra:

```tsx
    <p className="text-sm text-slate-300">
        Participan <strong>{pool.boletos}</strong> boletos de{' '}
        <strong>{pool.clientes}</strong> clientes distintos.
    </p>
    {cantidad > pool.clientes && (
        <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-300">
            Pides {cantidad} ganadores pero solo hay {pool.clientes} clientes distintos.
            Como un cliente no puede ganar dos veces, saldrán {pool.clientes} ganadores.
        </p>
    )}
```

Si `hayEjecucionPrevia`, muestra antes del botón de confirmar:

```tsx
    <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-300">
        Este sorteo ya tiene ganadores. Al ejecutarlo de nuevo se generará una lista
        nueva y la anterior quedará archivada, pero no se borrará.
    </p>
```

Al confirmar, llama a `ejecutarSorteo` y muestra el resultado con `toast`.

- [ ] **Paso 4: Crear el panel de ganadores**

Crea `components/sorteos/ganadores-panel.tsx`.

Props: `{ ejecucion, ganadores, puedeGestionar }`.

Muestra, arriba, los datos de la ejecución: fecha, quién la ejecutó, rango, tamaño del pool y
la semilla en fuente monoespaciada con un botón de copiar.

Lista de ganadores, cada uno con su posición, el número de boleto, el nombre y teléfono del
cliente, el premio, y un interruptor "Entregado" que llama a `marcarPremioEntregado`.

**Advertencia de boleto anulado.** Si `ganador.ticket.estado === 'anulado'`, muestra en esa
fila:

```tsx
    <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
        Boleto anulado después del sorteo
    </span>
```

El sistema permite anular un boleto ganador a propósito; lo que no permite es que pase
inadvertido.

**Botón "Verificar ejecución"**, que llama a `verificarEjecucion` y presenta el resultado:

```tsx
    {verificacion && (
        <div className={cn(
            'rounded-xl border p-4 text-sm',
            verificacion.coincide && verificacion.poolIntacto
                ? 'border-green-500/30 bg-green-500/10 text-green-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
        )}>
            <p className="font-medium">{verificacion.mensaje}</p>
            <dl className="mt-3 space-y-1 text-xs opacity-90">
                <div className="flex justify-between gap-4">
                    <dt>Algoritmo</dt>
                    <dd className="font-mono">{verificacion.algoritmo}</dd>
                </div>
                <div className="flex justify-between gap-4">
                    <dt>Semilla</dt>
                    <dd className="font-mono">{verificacion.semilla}</dd>
                </div>
                <div className="flex justify-between gap-4">
                    <dt>Participantes</dt>
                    <dd>{verificacion.poolCount} boletos</dd>
                </div>
            </dl>
        </div>
    )}
```

Debajo, un historial plegable de ejecuciones anteriores (`vigente = false`) con su fecha,
semilla y quién las ejecutó, para que quede claro que nada se borró.

- [ ] **Paso 5: Crear las páginas**

Crea `app/(dashboard)/sorteos/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos } from '@/lib/utils/permisos'
import { getSorteos } from '@/lib/actions/sorteos'
import { SorteosView } from '@/components/sorteos/sorteos-view'
import { PageHeader } from '@/components/layout/page-header'

export const dynamic = 'force-dynamic'

export default async function SorteosPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: perfil } = await supabase
        .from('profiles').select('id, rol, permisos').eq('id', user!.id).single()

    const permisos = getPermisos(perfil!)
    if (!permisos.ver_sorteos) redirect('/dashboard')

    const sorteos = await getSorteos()

    return (
        <div className="space-y-6 p-6">
            <PageHeader
                title="Sorteos"
                description="Campañas de sorteo y selección de ganadores"
            />
            <SorteosView sorteos={sorteos} puedeGestionar={permisos.realizar_sorteo} />
        </div>
    )
}
```

Crea `app/(dashboard)/sorteos/[id]/page.tsx` con la misma comprobación de permiso, llamando a
`getSorteoDetalle(id)` y renderizando: la cabecera del sorteo con sus acciones (Editar,
Activar, Cerrar, Ejecutar sorteo), el contador de boletos válidos, y `<GanadoresPanel />` si
hay ejecución vigente.

Si no hay ejecución vigente, muestra un estado vacío:

> Este sorteo todavía no tiene ganadores. Pulsa "Ejecutar sorteo" para seleccionarlos.

- [ ] **Paso 6: Añadir la asignación masiva de huérfanos**

`components/tickets/tickets-view.tsx` ya recibe `puedeAsignarSorteo: boolean` y
`sorteos: { id: string; nombre: string }[]` desde el Plan 1, Tarea 10: no hay que cambiar sus
props.

Cuando el filtro "Solo huérfanos" está activo **y** `puedeAsignarSorteo` es `true`, muestra
casillas de selección por fila y una barra de acción con un `Select` de sorteo y un botón
"Asignar N boletos", que llame a `asignarTicketsASorteo(idsSeleccionados, sorteoId)` y avise
con `toast.success(\`\${asignados} boletos asignados\`)`.

Ten en cuenta que la acción solo asigna los que siguen huérfanos y válidos, así que el número
devuelto puede ser menor que el seleccionado. Muestra el número real, no el que se marcó.

- [ ] **Paso 7: Verificar**

Ejecuta: `npm test && npx tsc --noEmit`
Esperado: todo en verde.

Con `npm run dev`:

1. Crea un sorteo y actívalo.
2. Emite varios boletos para al menos 5 clientes distintos (usa boletos manuales desde los
   perfiles). Comprueba que se numeran con el prefijo del sorteo.
3. Ejecuta el sorteo pidiendo 3 ganadores. Verifica que la vista previa del pool coincide con
   lo emitido.
4. Comprueba que no se repite ningún cliente entre los ganadores.
5. Pulsa **"Verificar ejecución"**: debe decir que los ganadores coinciden.
6. **Ejecuta el sorteo otra vez.** Los ganadores cambian y la ejecución anterior aparece en el
   historial, no desaparece.
7. Copia la semilla de la primera ejecución, ejecuta de nuevo pegándola en "Opciones
   avanzadas" y comprueba que **salen exactamente los mismos ganadores** que la primera vez.
   Ésta es la prueba de fuego de la reproducibilidad.
8. Anula un boleto ganador desde el perfil del cliente y recarga el sorteo: la fila del
   ganador debe mostrar "Boleto anulado después del sorteo".
9. Pide más ganadores que clientes distintos: debe avisar antes y entregar tantos ganadores
   como clientes haya.
10. **Cierra el sorteo** e intenta ejecutarlo: debe rechazarlo.
11. Con una cuenta de agente sin `ver_sorteos`, `/sorteos` redirige al dashboard.
12. Con `ver_sorteos` pero sin `realizar_sorteo`, se ven los sorteos y ganadores pero no
    aparecen los botones de crear ni ejecutar.

- [ ] **Paso 8: Commit**

```bash
git add components/sorteos "app/(dashboard)/sorteos" components/tickets/tickets-view.tsx
git commit -m "feat: interfaz de sorteos con ejecución y verificación de ganadores"
```

---

## Verificación final del Plan 3

- [ ] `npm test` — todo en verde, incluidas las 24 pruebas del algoritmo
- [ ] `npx tsc --noEmit` — sin errores
- [ ] `npm run build` — el build de producción completa
- [ ] `supabase/tests/ejecutar_sorteo.sql` pasa
- [ ] Reintroducir la semilla de una ejecución produce exactamente los mismos ganadores
- [ ] "Verificar ejecución" confirma en verde
- [ ] Ningún cliente gana dos veces en la misma ejecución
- [ ] Re-ejecutar archiva la ejecución anterior sin borrarla
- [ ] Un sorteo cerrado rechaza nuevas ejecuciones
- [ ] Un boleto anulado tras ganar queda marcado con la advertencia
- [ ] `grep -rn "Math.random" lib/` no devuelve nada en el camino del sorteo

---

## Cierre del módulo de boletería

Con los tres planes completos:

- [ ] Actualiza `README.md` con una sección del módulo de boletería
- [ ] Verifica el flujo completo: pago → modal → boleto → WhatsApp con PDF → impresión en
      sucursal → participación en el sorteo → selección de ganador → verificación
- [ ] Revisa que los permisos funcionan con una cuenta de agente real, no solo de admin
- [ ] Confirma que la cobranza original sigue funcionando igual que antes
