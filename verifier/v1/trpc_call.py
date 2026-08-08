#!/usr/bin/env python3
"""tRPC HTTP 调用器 — 考研传统阅读助手项目专用口径。

封装本项目 tRPC 11 (superjson) 的 HTTP 约定，避免踩坑：
  - query    -> GET  {BASE}/api/trpc/<proc>?input={"json": {...}}
  - mutation -> POST {BASE}/api/trpc/<proc>  body={"json": {...}}
  - 鉴权     -> X-Session-Token 头（v3 起）
  - 响应解包 -> result.data.json（superjson 信封）

用法（作为模块）：
    from trpc_call import Trpc
    api = Trpc("http://localhost:3000", token="<session-token 可省>")
    me   = api.query("auth.me")
    row  = api.mutation("auth.login", {"nickname": "小林", "password": "xxx"})

用法（命令行快速验证）：
    python3 trpc_call.py query passage.list
    python3 trpc_call.py mutation auth.login '{"nickname":"小林","password":"x"}' --token-file tok.txt

注意：
  - 用 POST 调 query 会 HTTP 405（本项目实测）；用 GET 调 mutation 同理不行。
  - 无输入的 query 传 {"json": null}；本项目部分 proc 还需 meta.values=["undefined"]，
    用 query(..., undefined=True) 自动补齐。
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE = "http://localhost:3000"
TRPC_PREFIX = "/api/trpc"


class TrpcError(RuntimeError):
    """HTTP 或 tRPC 层错误，附带服务端返回体便于断言。"""

    def __init__(self, status: int | None, body: str):
        self.status = status
        self.body = body
        super().__init__(f"TrpcError(status={status}): {body[:500]}")


class Trpc:
    def __init__(self, base: str = DEFAULT_BASE, token: str | None = None, timeout: float = 60.0):
        self.base = base.rstrip("/")
        self.token = token
        self.timeout = timeout

    # ---- 公开 API ---------------------------------------------------------

    def query(self, proc: str, payload: object = None, *, undefined: bool = False) -> object:
        """调用 tRPC query（GET）。payload 为业务入参（自动包进 {"json": ...}）。"""
        envelope: dict = {"json": payload}
        if undefined and payload is None:
            envelope["meta"] = {"values": ["undefined"]}
        url = f"{self.base}{TRPC_PREFIX}/{proc}?input={urllib.parse.quote(json.dumps(envelope))}"
        return self._open(url, method="GET")

    def mutation(self, proc: str, payload: object = None) -> object:
        """调用 tRPC mutation（POST）。payload 为业务入参（自动包进 {"json": ...}）。"""
        url = f"{self.base}{TRPC_PREFIX}/{proc}"
        data = json.dumps({"json": payload}).encode("utf-8")
        return self._open(url, method="POST", data=data)

    # ---- 内部 -------------------------------------------------------------

    def _open(self, url: str, *, method: str, data: bytes | None = None) -> object:
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        # relay/网关类后端可能按 UA 过滤；API 测试统一带浏览器 UA，与前端行为一致
        req.add_header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        )
        if self.token:
            req.add_header("X-Session-Token", self.token)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:  # 4xx/5xx：保留返回体
            raise TrpcError(e.code, e.read().decode("utf-8", "replace")) from e
        except urllib.error.URLError as e:
            raise TrpcError(None, str(e)) from e
        return self._unwrap(body)

    @staticmethod
    def _unwrap(body: str) -> object:
        doc = json.loads(body)
        if "error" in doc:
            raise TrpcError(None, json.dumps(doc["error"], ensure_ascii=False))
        try:
            return doc["result"]["data"]["json"]
        except (KeyError, TypeError) as e:
            raise TrpcError(None, f"无法解包 tRPC 响应: {body[:500]}") from e


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="tRPC HTTP 调用器（考研阅读助手口径）")
    p.add_argument("kind", choices=["query", "mutation"])
    p.add_argument("proc", help="如 passage.list / auth.login")
    p.add_argument("payload", nargs="?", default=None, help="JSON 字符串，默认 null")
    p.add_argument("--base", default=DEFAULT_BASE)
    p.add_argument("--token", default=None)
    p.add_argument("--token-file", default=None, help="从文件读 session token")
    args = p.parse_args(argv)

    token = args.token
    if args.token_file:
        with open(args.token_file, encoding="utf-8") as f:
            token = f.read().strip()
    payload = json.loads(args.payload) if args.payload else None
    api = Trpc(args.base, token=token)
    try:
        out = api.query(args.proc, payload) if args.kind == "query" else api.mutation(args.proc, payload)
    except TrpcError as e:
        print(str(e), file=sys.stderr)
        return 1
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
