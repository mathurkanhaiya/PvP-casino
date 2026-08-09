FROM node:22-alpine

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json tsconfig.base.json ./

COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/

# Allow pnpm install scripts during the image build so the install step succeeds in CI/Docker.
# NOTE: This approves all install scripts. For a more secure solution, generate and commit
# .pnpm-allowlist.yaml by running `pnpm approve-builds` locally and copy it into the image instead.
ENV PNPM_APPROVE_BUILDS=1

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["sh", "-c", "pnpm --filter @workspace/db push-force && node --enable-source-maps artifacts/api-server/dist/index.mjs"]
