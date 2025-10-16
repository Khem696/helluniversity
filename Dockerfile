FROM node:18-alpine

# Install system deps needed by Next.js and sharp
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Install dependencies first (leverage Docker layer cache)
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN if [ -f package-lock.json ]; then npm ci; \
    elif [ -f yarn.lock ]; then yarn --frozen-lockfile; \
    elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm i --frozen-lockfile; \
    else npm i; fi

# Copy the rest of the app
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1 \
    HOST=0.0.0.0 \
    PORT=3000

EXPOSE 3000

# Default to dev for local testing to keep API routes available despite output: 'export'
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0", "-p", "3000"]


