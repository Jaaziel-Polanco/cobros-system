# ── Stage 1: Dependencias y build ──────────────────────────────
# Una sola etapa: antes había una etapa `deps` aparte y copiar su
# node_modules a esta (~700 MB) costaba ~55 s cada vez que cambiaba el
# lockfile. La capa de `npm ci` se sigue cacheando mientras
# package-lock.json no cambie.
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .

# Sólo las variables públicas: Next las incrusta en el bundle al compilar.
# La service role key NO hace falta para compilar (todo lo que la lee es
# dinámico) y no debe quedar en las capas de la imagen: llega en runtime por
# el entorno del servicio.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

# `npm run build` compila con webpack (ver package.json): en el servidor de
# producción (1 vCPU, poca RAM libre) Turbopack llegaba a ~1,5 GB de memoria
# nativa y dejó sin memoria a todo el host; webpack se queda en la mitad.
RUN npm run build

# ── Stage 2: Production runner ─────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Custom server with node-cron
COPY --from=builder --chown=nextjs:nodejs /app/server.js ./server.js

# Dependencias de server.js que el trazado de Next no ve; ninguna tiene
# dependencias propias. Antes se hacía `npm install` aquí, que con el
# package.json del standalone reinstalaba ~200 paquetes desde el registro
# (~2 min por build) en versiones distintas a las del lockfile.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/node-cron ./node_modules/node-cron
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/dotenv ./node_modules/dotenv

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
