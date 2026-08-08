#!/usr/bin/env python3
"""补充验收：非 LLM 功能域全覆盖（渠道 CRUD/导出/工单/生词/错题/管理台/essay 草稿/retro/interactive/content/method）。

与 test_v5_api.py 互补：本脚本专注无需真实渠道密钥即可验证的功能域，
LLM 依赖接口（channel.test / agent.generate / insight.analyze / essay.startDraft / method.parseSentence）不在本脚本内。

用法：
    cd verifier/v1
    PYTHONUTF8=1 python verify_extra.py        # 需本地 3000 端口服务在跑

环境：
    BASE 默认 http://localhost:3000，可用环境变量覆盖；
    APP  项目根目录（需含 node_modules 与 .env，供 mysql2 直查），默认向上探测，可用环境变量覆盖。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from trpc_call import Trpc, TrpcError  # noqa: E402

BASE = os.environ.get("BASE", "http://localhost:3000")
PASSWORD = os.environ.get("VERIFY_PASSWORD", "Test#2026v5")
passed: list[str] = []
failed: list[tuple[str, str]] = []


def P(name: str, cond: bool, extra: str = ""):
    if cond:
        passed.append(name)
        print(f"  ✓ {name}")
    else:
        failed.append((name, extra))
        print(f"  ✗ {name}  {extra}")


def expect_err(name: str, fn, code: str | None = None, http: int | None = None):
    try:
        fn()
    except TrpcError as e:
        ok = True
        if http is not None:
            ok = e.status == http
        if code is not None:
            ok = ok and code in e.body
        P(name, ok, f"status={e.status} body={e.body[:160]}")
        return
    P(name, False, "预期报错却成功了")


def login(name: str, pw: str = PASSWORD) -> str:
    anon = Trpc(base=BASE)
    try:
        return anon.mutation("auth.register", {
            "name": name, "password": pw,
            "recoveryQuestion": "验证问题", "recoveryAnswer": "验证答案",
        })["token"]
    except TrpcError:
        return anon.mutation("auth.login", {"name": name, "password": pw})["token"]


def find_app_root() -> str:
    """探测项目根目录：优先环境变量 APP，否则从本脚本位置向上找含 node_modules 的目录。"""
    env = os.environ.get("APP")
    if env and os.path.isdir(env) and os.path.isfile(os.path.join(env, "package.json")):
        return env
    d = HERE
    while True:
        if os.path.isfile(os.path.join(d, "package.json")) and os.path.isdir(os.path.join(d, "node_modules")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return HERE


APP = find_app_root()


def dbq(sql: str) -> object:
    """通过 node mysql2 直查数据库（写临时 .cjs，在项目根目录解析 mysql2 + dotenv）。"""
    script = f"""
require("dotenv").config();
const mysql = require("mysql2/promise");
(async () => {{
  const c = await mysql.createConnection({{ uri: process.env.DATABASE_URL, timezone: "Z" }});
  const [rows] = await c.query({json.dumps(sql)});
  console.log(JSON.stringify(rows));
  await c.end();
}})().catch((e) => {{ console.error("DBERR:" + e.message); process.exit(1); }});
"""
    tmp = os.path.join(APP, "_verify_tmp.cjs")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(script)
    try:
        out = subprocess.run(["node", "_verify_tmp.cjs"], cwd=APP, capture_output=True, text=True, timeout=30)
        if out.returncode != 0:
            raise RuntimeError(out.stderr[:300] or out.stdout[:300])
        # dotenv 横幅会污染 stdout，取最后一行 JSON
        return json.loads([l for l in out.stdout.strip().splitlines() if l.strip()][-1])
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def main() -> None:
    tok = login("verify_extra_" + str(int(time.time())))
    api = Trpc(base=BASE, token=tok)
    ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "KyAdmin#2026!")
    adm = Trpc(base=BASE, token=Trpc(base=BASE).mutation("auth.login", {"name": "admin", "password": ADMIN_PW})["token"])

    print("══ 渠道中台 CRUD（假 key，不调 LLM） ══")
    chs = api.query("channel.list")
    n0 = len(chs)
    r = api.mutation("channel.create", {"name": "验收测试渠道", "kind": "chat", "protocol": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "sk-test-verify", "models": ["gpt-test"], "isDefault": False, "personal": True})
    P("C1 新增渠道", isinstance(r.get("id"), int))
    chs2 = api.query("channel.list")
    P("C2 渠道列表+1", len(chs2) == n0 + 1)
    cid = next(c["id"] for c in chs2 if c["name"] == "验收测试渠道")
    r2 = api.mutation("channel.update", {"id": cid, "name": "验收测试渠道-改", "protocol": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "sk-test-verify2", "model": "gpt-test2"})
    P("C3 渠道更新", r2.get("name") == "验收测试渠道-改")
    api.mutation("channel.remove", {"id": cid})
    chs3 = api.query("channel.list")
    P("C4 渠道删除", len(chs3) == n0)
    expect_err("C5 游客新增渠道→401", lambda: Trpc(base=BASE).mutation("channel.create", {"name": "x", "protocol": "openai", "baseUrl": "https://x", "apiKey": "k", "model": "m"}), http=401)
    # 绑定管理
    b = api.query("channel.listBindings")
    P("C6 绑定列表可读", isinstance(b, list) and len(b) > 0)

    print("══ 导出与备份 ══")
    bk = api.query("export.fullBackup")
    P("D1 全量备份导出", isinstance(bk, dict) and len(bk) > 0, f"keys={list(bk.keys())[:6]}")
    pre = api.mutation("export.importBackup", {"backup": bk, "strategy": "skip", "dryRun": True})
    P("D2 备份导入预览(dryRun)", isinstance(pre, dict), str(pre)[:120])

    print("══ 工单与公告 ══")
    nb = api.query("ticket.notices")
    P("E1 游客可读历期公告", isinstance(nb, list) and len(nb) >= 1)
    t = api.mutation("ticket.create", {"title": "验收反馈", "content": "自动化验收工单", "category": "bug"})
    P("E2 提交反馈工单", isinstance(t.get("id"), int), str(t)[:80])
    ml = api.query("ticket.myList", {})
    P("E3 我的工单列表", any(x["id"] == t["id"] for x in ml))
    d = api.query("ticket.detail", {"id": t["id"]})
    st0 = d.get("ticket", {}).get("status", "")
    P("E4 工单详情", st0 == "open", st0)
    api.mutation("ticket.reply", {"ticketId": t["id"], "content": "补充说明"})
    d2 = api.query("ticket.detail", {"id": t["id"]})
    P("E5 用户追评", any(r_.get("authorRole") == "user" and r_.get("content") == "补充说明" for r_ in d2.get("replies", [])))
    ar = adm.mutation("ticket.adminReply", {"ticketId": t["id"], "content": "已收到,处理中"})
    P("E6 管理台回复", bool(ar))
    d3 = api.query("ticket.detail", {"id": t["id"]})
    P("E7 回复可见", any(r_.get("authorRole") == "admin" for r_ in d3.get("replies", [])))
    adm.mutation("ticket.adminReply", {"ticketId": t["id"], "content": "处理完毕,关闭", "status": "closed"})
    P("E8 管理台流转关闭", bool(adm.mutation("ticket.adminReply", {"ticketId": t["id"], "content": "处理完毕,关闭", "status": "closed"})))
    st = api.query("ticket.myList", {})
    stt = next(x for x in st if x["id"] == t["id"])
    P("E9 关闭状态落库", stt.get("status") == "closed", stt.get("status"))
    notice = adm.mutation("ticket.publishNotice", {"title": "验收公告·自动化", "content": "全链路验收公告", "digest": "验收"})
    P("E10 发布公告", isinstance(notice.get("id"), int))
    nb2 = api.query("ticket.notices")
    P("E11 公告上墙", any(x["title"] == "验收公告·自动化" for x in nb2))

    print("══ 生词本(直插数据验证链路,lookup 走缓存分支) ══")
    me = api.query("auth.me")
    uid = me["id"]
    dbq(f"DELETE FROM vocab_items WHERE word='verification' AND user_id={uid}")
    dbq(f"INSERT INTO vocab_items (user_id, word, zh, familiarity) VALUES ({uid}, 'verification', '验证;核实', 0)")
    vl = api.query("vocab.list", {})
    P("F1 生词列表含新词", any(x["word"] == "verification" for x in vl))
    look = api.mutation("vocab.lookup", {"word": "verification"})
    P("F2 查词命中缓存", look.get("cached") is True and look.get("item", {}).get("zh", "").startswith("验证"), str(look)[:100])
    target = next(x for x in vl if x["word"] == "verification")
    r = api.mutation("vocab.setFamiliarity", {"id": target["id"], "familiarity": 2})
    P("F3 熟悉度更新", bool(r))
    vl2 = api.query("vocab.list", {})
    P("F4 熟悉度落库", next(x for x in vl2 if x["id"] == target["id"])["familiarity"] == 2)
    api.mutation("vocab.remove", {"id": target["id"]})
    vl3 = api.query("vocab.list", {})
    P("F5 生词删除", not any(x["id"] == target["id"] for x in vl3))

    print("══ 错题本 ══")
    wl = api.query("wrong.list", {})
    P("G1 错题列表可读", isinstance(wl, list))
    st = api.query("agent.stats")
    P("G2 统计可读", isinstance(st, dict))

    print("══ 管理台 ══")
    ov = adm.query("admin.overview")
    P("H1 管理台概览", isinstance(ov, dict) and len(ov) > 0, str(ov)[:100])
    us = adm.query("admin.listUsers", {})
    P("H2 用户列表", isinstance(us, list) and len(us) > 0)
    gs = adm.query("admin.getSettings", {})
    P("H3 站点设置可读", isinstance(gs, dict))
    expect_err("H4 普通用户进管理台→403", lambda: api.query("admin.overview"), http=403)

    print("══ essay 草稿(非 LLM 部分) ══")
    el = api.query("essay.list", {})
    P("I1 作文列表可读", isinstance(el, list))
    dl = api.query("essay.draftList", {})
    P("I2 草稿列表可读", isinstance(dl, list))
    ml2 = api.query("essay.materialList", {})
    P("I3 素材库可读", isinstance(ml2, list))
    expect_err("I4 游客读作文→401", lambda: Trpc(base=BASE).query("essay.list", {}), http=401)

    print("══ retro 复盘 ══")
    det = Trpc(base=BASE).query("passage.detail", {"id": 1})
    q1 = det["questions"][0]
    official = q1["answer"]
    ai_answer = next(c for c in "ABCD" if c != official)
    api.mutation("agent.saveResult", {
        "kind": "exam", "passageId": 1, "payload": {"test": True}, "modelUsed": "test",
        "answers": {str(q1["id"]): ai_answer}, "verdicts": {str(q1["id"]): False},
        "solvedItems": [{"qNo": q1["qNo"], "answer": ai_answer, "qType": q1["qType"]}],
        "durationSec": 60, "skipAnalysis": True,
    })
    rec = dbq(f"SELECT id FROM practice_records WHERE user_id={uid} ORDER BY id DESC LIMIT 1")[0]
    rr = api.query("retro.forRecord", {"recordId": rec["id"]})
    P("J1 复盘列表可读", isinstance(rr, list), str(rr)[:80])

    print("══ interactive 跟我练 ══")
    av = api.query("interactive.availability", {"kind": "exam", "refId": 1})
    P("K1 跟我练可用性检查", isinstance(av, dict), str(av)[:100])
    hist = api.query("interactive.history", {"kind": "exam", "refId": 1})
    P("K2 练习历史可读", isinstance(hist, list))

    print("══ content 内容 ══")
    ks = api.query("knowledge.list")
    P("L1 知识卡列表", isinstance(ks, list) and len(ks) > 0, f"got {len(ks)}")
    mc = api.query("method.clauses", {})
    P("L2 方法条款(公开)", isinstance(mc, list) and len(mc) > 0, f"got {len(mc)}")
    pl = api.query("prompt.list", {})
    P("L3 提示词列表", isinstance(pl, list))

    print(f"\n════ 结果: {len(passed)} 通过 / {len(failed)} 失败 ════")
    for name, extra in failed:
        print(f"  ✗ {name}: {extra}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
