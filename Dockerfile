# ── 构建阶段：安装依赖并产出 dist/ ─────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── 运行阶段：仅保留生产依赖与构建产物 ──────────────────────────
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
# 首次启动自举所需：迁移 SQL + meta（drizzle 读 meta/_journal.json）+ 真题语料
COPY db/ ./db/
# 一次性数据恢复（compose --profile restore）依赖的导入脚本
COPY scripts_restore_dump.mjs ./
# 兜底：自举三样资产在镜像里必须真实存在，构建期就卡住，绝不让运行期才发现
RUN test -f ./db/final_corpus.json \
 && test -f ./db/migrations/meta/_journal.json \
 && ls ./db/migrations/*.sql >/dev/null 2>&1 \
 && echo "bootstrap assets OK" \
 || (echo "FATAL: bootstrap assets missing in image" && exit 1)
EXPOSE 3000
CMD ["node", "dist/boot.js"]
