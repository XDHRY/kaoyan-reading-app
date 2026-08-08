import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

export const env = {
  // APP_ID / APP_SECRET 为可选平台变量：本项目未使用，缺省绝不阻断启动
  appId: process.env.APP_ID ?? "",
  appSecret: process.env.APP_SECRET ?? "",
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  // CORS 显式白名单（逗号分隔的完整 origin）；缺省时仅用内置白名单（同源不受影响）
  corsOrigins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
