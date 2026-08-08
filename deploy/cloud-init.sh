#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# 纸上功夫(考研传统阅读助手)·云服务器一键部署脚本
# 适用:Ubuntu/Debian 全新轻量服务器(建议 2GB 内存以上,带公网 IP)
# 流程:装 Docker → 拉代码(分支 packaging/exe-apk)→ 交互生成 .env →
#       构建启动 → 等待健康 → 输出访问信息与数据恢复指引
# 幂等:可重复执行;已装 Docker / 已有代码 / 已有 .env 均会保留(或询问)。
# 用法:sudo bash cloud-init.sh
# 可选环境变量:APP_DIR 自定义代码目录;
#              ADMIN_PASSWORD / DB_PASSWORD / APP_PORT / DB_PORT / APP_SECRET / CORS_ORIGINS 免交互覆盖
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_URL="https://github.com/XDHRY/kaoyan-reading-app.git"
BRANCH="main"
APP_DIR="${APP_DIR:-/opt/kaoyan-reading-app}"

info() { printf '\033[1;32m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

# 随机串生成(openssl 优先,兜底 /dev/urandom)
gen_rand() {
  local n="$1"
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$n";
  else tr -dc 'a-zA-Z0-9' < /dev/urandom | head -c "$((n * 2))"; fi
}

# ── 0. 前置检查 ──
[ "$(id -u)" -eq 0 ] || fail "请用 root 运行:sudo bash cloud-init.sh"
command -v curl >/dev/null 2>&1 || { info "安装 curl..."; apt-get update -qq && apt-get install -y -qq curl; }

# ── 1. 安装 Docker(幂等)──
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  info "✓ Docker 已安装,跳过安装"
else
  info "▶ 安装 Docker(get.docker.com)..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker || true
fi

# ── 2. 拉取代码(幂等:已存在则更新)──
if [ -d "$APP_DIR/.git" ]; then
  info "✓ 代码已存在,更新到分支 ${BRANCH}..."
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH" 2>/dev/null || git -C "$APP_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
  git -C "$APP_DIR" pull --ff-only || warn "本地有未提交改动,跳过 pull(可手工处理后重跑)"
else
  info "▶ 克隆仓库到 ${APP_DIR} ..."
  mkdir -p "$APP_DIR"
  git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ── 3. 生成 .env(幂等:已存在则询问;新生成则先收集配置)──
ENV_FILE="$APP_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  info "✓ 检测到已有 $ENV_FILE"
  keep="Y"
  if [ -t 0 ]; then
    read -r -p "保留现有配置继续部署? [Y/n] " keep
  fi
  if [[ "${keep:-Y}" =~ ^[Nn]$ ]]; then
    cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"
    rm -f "$ENV_FILE"
    info "旧配置已备份为 $ENV_FILE.bak.*,重新生成"
  fi
fi

if [ ! -f "$ENV_FILE" ]; then
  if [ ! -t 0 ]; then
    # 非交互(管道/CI):全部走环境变量或自动生成,ADMIN_PASSWORD 必须由调用方提供
    : "${ADMIN_PASSWORD:?非交互模式必须通过 ADMIN_PASSWORD 环境变量提供管理员密码}"
    admin_pw="$ADMIN_PASSWORD"
    db_pw="${DB_PASSWORD:-$(gen_rand 16)}"
    app_port="${APP_PORT:-3000}"
    db_port="${DB_PORT:-3306}"
    app_secret="${APP_SECRET:-$(gen_rand 24)}"
    cors_origins="${CORS_ORIGINS:-}"
  else
    echo "──────────────────────────────────────────────"
    echo "  填写部署配置(回车使用默认值;管理员密码必填)"
    echo "──────────────────────────────────────────────"
    while :; do
      read -r -s -p "管理员 admin 初始密码(必填): " admin_pw; echo
      [ -n "$admin_pw" ] || { warn "密码不能为空,请重新输入"; continue; }
      read -r -s -p "再次输入确认: " admin_pw2; echo
      [ "$admin_pw" = "$admin_pw2" ] && break
      warn "两次输入不一致,请重来"
    done
    db_pw="$(gen_rand 16)"
    read -r -p "MySQL 业务口令[回车自动生成]: " db_pw_in
    db_pw="${db_pw_in:-$db_pw}"
    app_port="${APP_PORT:-3000}"
    read -r -p "应用对外端口 APP_PORT[${app_port}]: " port_in
    app_port="${port_in:-$app_port}"
    db_port="${DB_PORT:-3306}"
    read -r -p "MySQL 对外端口 DB_PORT[${db_port}](本机已有 MySQL 请改 3307): " dport_in
    db_port="${dport_in:-$db_port}"
    app_secret="${APP_SECRET:-$(gen_rand 24)}"
    read -r -p "APP_SECRET 应用密钥[回车自动生成]: " secret_in
    app_secret="${secret_in:-$app_secret}"
    read -r -p "CORS_ORIGINS 额外白名单[回车留空](APK 场景无需填写): " cors_origins
  fi

  root_pw="$(gen_rand 16)"
  # 逐行写入(引号包裹变量,口令含 $ 等特殊字符也不会被二次展开)
  {
    echo "APP_ID="
    echo "APP_SECRET=${app_secret}"
    echo "ADMIN_PASSWORD=${admin_pw}"
    echo "DATABASE_URL=mysql://kaoyan:${db_pw}@mysql:3306/kaoyan_reading"
    echo "MYSQL_ROOT_PASSWORD=${root_pw}"
    echo "MYSQL_DATABASE=kaoyan_reading"
    echo "MYSQL_USER=kaoyan"
    echo "MYSQL_PASSWORD=${db_pw}"
    echo "APP_PORT=${app_port}"
    echo "DB_PORT=${db_port}"
    echo "PORT=3000"
    echo "CORS_ORIGINS=${cors_origins}"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  info "✓ 已生成 $ENV_FILE(含口令,已设 600 权限,勿提交/外传)"
fi

# ── 4. 构建并启动 ──
info "▶ docker compose up -d --build ..."
docker compose up -d --build

# ── 5. 等待健康(与 app 容器健康检查同口径:探 /api/trpc/ping)──
app_port_now="$(grep -E '^APP_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '" ')"
app_port_now="${app_port_now:-3000}"
info "▶ 等待服务就绪(最长 3 分钟)..."
for i in $(seq 1 36); do
  if curl -fsS "http://127.0.0.1:${app_port_now}/api/trpc/ping" >/dev/null 2>&1; then
    info "✓ 服务已就绪:http://127.0.0.1:${app_port_now}"
    break
  fi
  [ "$i" -eq 36 ] && fail "等待超时,请查看日志:docker compose -f ${APP_DIR}/docker-compose.yml logs -f app"
  sleep 5
done

# ── 6. 输出访问信息与后续指引 ──
info "══════════ 部署完成 ══════════"
echo "  本机访问:  http://127.0.0.1:${app_port_now}"
echo "  公网访问:  http://<服务器公网IP>:${app_port_now}(公网 IP 在服务器控制台查看)"
echo "  管理员:    admin(密码见 ${ENV_FILE} 的 ADMIN_PASSWORD)"
echo "  免备案:    国内服务器「IP + 非 80/443 端口」直连免备案;80/443 需域名备案"
echo "  APK 对接:  App 内置 API 地址填 http://<公网IP>:${app_port_now},WebView 的"
echo "             capacitor://localhost 已在默认 CORS 白名单,无需配置 CORS_ORIGINS"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "active"; then
  echo "  防火墙:    已检测到 ufw 开启,请放行:ufw allow ${app_port_now}/tcp"
fi
echo "  查看日志:  docker compose -f ${APP_DIR}/docker-compose.yml logs -f app"
echo "  数据恢复(仅空库,可选):"
echo "    cd ${APP_DIR} && tar -xzf db/dump.tar.gz"
echo "    docker compose --profile restore run --rm restore"
echo "═════════════════════════════"
