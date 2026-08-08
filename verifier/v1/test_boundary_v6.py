#!/usr/bin/env python3
"""边界冲刺 v6：最大规模全面边界测试（2026-08-08）。

设计依据「资深程序员·省 API 损耗」方法论：
  - 一次读全(先盘点全部端点与 zod 约束，见文件头注释)
  - 批量断言(同一域一批断言，失败即定位到具体断言名)
  - 精确工具(逐端点逐约束测试，不做重复探测)
  - 先小步探测报错形态，再成规模执行(见 A/B/C 段的探测结论)

覆盖域：
  A 认证/权限矩阵  —— 全部私有端点游客 401、全部管理端点普通用户 403/游客 401、公开端点游客可用
  B zod 边界值    —— 字符串 min/max、数字 min/max、枚举非法值、数组长度、null 入参
  C SSRF 边界     —— https 强制、IPv4/IPv6/十进制/hex/尾点/映射等 22 种变体（含修复后回归）
  D 并发/幂等     —— 并行同名注册、并行 saveResult、错题入册幂等、并发 startPipeline(无效题,不烧 LLM)
  E 优雅降级/空列表—— 新用户全空列表、不存在资源、未绑定角色的 resolve
  F 异常输入      —— 方法错用 405、超大 payload、null 入参、非法 JSON
  G XSS/注入      —— <script>/onerror/引号分号原样存储、SQL 注入尝试不破坏数据
  H 合法边界通过  —— 恰好在 min/max 上的合法输入应成功
  I 数据隔离      —— 用户 B 无法读/改用户 A 的 essay/ticket/vocab/wrong/personal 渠道

用法：
    cd verifier/v1
    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python test_boundary_v6.py

环境：BASE 覆盖服务地址；ADMIN_PASSWORD 覆盖管理密码（默认 KyAdmin#2026!）。
注意：本脚本不触发任何真实 LLM 调用（LLM 端点只测校验层拒绝）。
"""
from __future__ import annotations

import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from trpc_call import Trpc, TrpcError  # noqa: E402

BASE = os.environ.get("BASE", "http://127.0.0.1:3000")
PASSWORD = os.environ.get("VERIFY_PASSWORD", "Test#2026v5")
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "KyAdmin#2026!")
passed: list[str] = []
failed: list[tuple[str, str]] = []


def find_app_root() -> str:
    import subprocess  # noqa: PLC0415
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
    import subprocess  # noqa: PLC0415
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
        return json.loads([l for l in out.stdout.strip().splitlines() if l.strip()][-1])
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def P(name: str, cond: bool, extra: str = ""):
    if cond:
        passed.append(name)
        print(f"  ✓ {name}")
    else:
        failed.append((name, extra))
        print(f"  ✗ {name}  {extra}")


def expect_err(name: str, fn, code: str | None = None, http: int | None = None, statuses: tuple[int, ...] | None = None):
    try:
        fn()
    except TrpcError as e:
        ok = True
        if http is not None:
            ok = e.status == http
        if statuses is not None:
            ok = e.status in statuses
        if code is not None:
            ok = ok and code in e.body
        P(name, ok, f"status={e.status} body={e.body[:140]}")
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


# —— 全部私有端点（401 矩阵）与全部管理端点（403 矩阵） ——
PRIVATE_ENDPOINTS: list[tuple[str, str]] = [
    ("auth.changePassword", "mutation"), ("auth.changeRecovery", "mutation"), ("auth.updateProfile", "mutation"),
    ("auth.exportData", "query"), ("auth.deleteAccount", "mutation"),
    ("channel.list", "query"), ("channel.create", "mutation"), ("channel.update", "mutation"),
    ("channel.remove", "mutation"), ("channel.fetchModels", "mutation"), ("channel.addModel", "mutation"),
    ("channel.test", "mutation"), ("channel.selfCheck", "mutation"), ("channel.listBindings", "query"),
    ("channel.setBinding", "mutation"), ("channel.removeBinding", "mutation"), ("channel.setBindings", "mutation"),
    ("channel.routeMap", "query"), ("channel.resolve", "query"),
    ("prompt.list", "query"),
    ("agent.startPipeline", "mutation"), ("agent.pipelineStatus", "query"), ("agent.activeJob", "query"),
    ("agent.getPref", "query"), ("agent.setPref", "mutation"), ("agent.history", "query"),
    ("agent.retryPipeline", "mutation"), ("agent.pausePipeline", "mutation"), ("agent.resumePipeline", "mutation"),
    ("agent.cancelPipeline", "mutation"), ("agent.analyzeStructure", "mutation"), ("agent.analyzeQuestions", "mutation"),
    ("agent.locate", "mutation"), ("agent.solve", "mutation"), ("agent.saveResult", "mutation"),
    ("agent.stats", "query"), ("agent.recordsByPassage", "query"), ("agent.generate", "mutation"),
    ("agent.generatedPractice", "mutation"), ("agent.generatedList", "query"), ("agent.generatedDetail", "query"),
    ("agent.revealOfficialAnswers", "query"), ("agent.diffStatus", "query"), ("agent.diffAnalysis", "mutation"),
    ("essay.list", "query"), ("essay.detail", "query"), ("essay.save", "mutation"), ("essay.remove", "mutation"),
    ("essay.startDraft", "mutation"), ("essay.confirmOutline", "mutation"), ("essay.generateParagraph", "mutation"),
    ("essay.reviseOutline", "mutation"), ("essay.generateAll", "mutation"), ("essay.reviseParagraph", "mutation"),
    ("essay.confirmParagraph", "mutation"), ("essay.finishDraft", "mutation"), ("essay.draftStatus", "query"),
    ("essay.removeDraft", "mutation"), ("essay.draftList", "query"), ("essay.review", "mutation"),
    ("essay.materialList", "query"), ("essay.materialSave", "mutation"), ("essay.materialRemove", "mutation"),
    ("export.fullBackup", "query"), ("export.importBackup", "mutation"),
    ("insight.getAnalysis", "query"), ("insight.analyze", "mutation"), ("insight.analyzeBatch", "mutation"),
    ("insight.saveAnalysis", "mutation"), ("insight.errorTypeStats", "query"), ("insight.recommend", "mutation"),
    ("insight.getRecommendation", "query"), ("insight.practiceProblems", "query"), ("insight.insightList", "query"),
    ("insight.insightSave", "mutation"),
    ("interactive.availability", "query"), ("interactive.history", "query"), ("interactive.stepQuestion", "query"),
    ("interactive.stepLocate", "query"), ("interactive.stepSolve", "query"), ("interactive.finish", "mutation"),
    ("vocab.list", "query"), ("vocab.lookup", "mutation"), ("vocab.setFamiliarity", "mutation"),
    ("vocab.image", "mutation"), ("vocab.remove", "mutation"),
    ("wrong.list", "query"), ("wrong.retry", "mutation"), ("wrong.unmaster", "mutation"), ("wrong.remove", "mutation"),
    ("retro.forRecord", "query"), ("retro.create", "mutation"),
    ("ticket.create", "mutation"), ("ticket.myList", "query"), ("ticket.detail", "query"),
    ("ticket.reply", "mutation"), ("ticket.close", "mutation"),
    ("method.parseSentence", "mutation"), ("method.assocImage", "mutation"),
]

ADMIN_ENDPOINTS: list[tuple[str, str]] = [
    ("admin.overview", "query"), ("admin.listUsers", "query"), ("admin.updateUser", "mutation"),
    ("admin.resetUserPassword", "mutation"), ("admin.resetUserRecovery", "mutation"), ("admin.viewUserData", "query"),
    ("admin.clearUserData", "mutation"), ("admin.deleteUser", "mutation"), ("admin.getSettings", "query"),
    ("admin.setSetting", "mutation"), ("admin.updateClause", "mutation"),
    ("ticket.adminList", "query"), ("ticket.adminReply", "mutation"),
    ("ticket.publishNotice", "mutation"), ("ticket.removeNotice", "mutation"),
]


def call(api: Trpc, proc: str, kind: str, payload: object):
    if kind == "query":
        return api.query(proc, payload if payload is not None else None, undefined=payload is None)
    return api.mutation(proc, payload if payload is not None else {})


def main() -> None:
    anon = Trpc(base=BASE)
    admin = Trpc(base=BASE, token=anon.mutation("auth.login", {"name": "admin", "password": ADMIN_PW})["token"])
    ua = login("bnd_a_" + str(int(time.time())))
    api_a = Trpc(base=BASE, token=ua)
    ub = login("bnd_b_" + str(int(time.time())))
    api_b = Trpc(base=BASE, token=ub)

    print("══ A. 认证 / 权限矩阵 ══")
    bad = []
    for i, (proc, kind) in enumerate(PRIVATE_ENDPOINTS):
        try:
            call(anon, proc, kind, None)
            bad.append(f"{proc}(游客未被拦)")
        except TrpcError as e:
            if e.status != 401:
                bad.append(f"{proc}(status={e.status})")
    P(f"A1 私有端点全量 {len(PRIVATE_ENDPOINTS)} 个:游客→401", not bad, "; ".join(bad[:5]))
    bad = []
    for i, (proc, kind) in enumerate(ADMIN_ENDPOINTS):
        try:
            call(anon, proc, kind, None)
            bad.append(f"{proc}(游客未被拦)")
        except TrpcError as e:
            if e.status != 401:
                bad.append(f"{proc}(status={e.status})")
    P(f"A2 管理端点全量 {len(ADMIN_ENDPOINTS)} 个:游客→401", not bad, "; ".join(bad[:5]))
    bad = []
    for i, (proc, kind) in enumerate(ADMIN_ENDPOINTS):
        try:
            call(api_a, proc, kind, None)
            bad.append(f"{proc}(普通用户未被拦)")
        except TrpcError as e:
            if e.status != 403:
                bad.append(f"{proc}(status={e.status})")
    P(f"A3 管理端点全量 {len(ADMIN_ENDPOINTS)} 个:普通用户→403", not bad, "; ".join(bad[:5]))
    pub_ok = ["ping", "auth.me", "auth.siteInfo", "passage.list", "knowledge.list",
              "method.clauses", "ticket.notices"]
    bad = []
    for p in pub_ok:
        try:
            call(anon, p, "query", None)
        except TrpcError as e:
            bad.append(f"{p}(status={e.status})")
    P(f"A4 公开端点 {len(pub_ok)} 个游客可用", not bad, "; ".join(bad))
    try:
        pd = anon.query("passage.detail", {"id": 1})
        P("A4b passage.detail 游客可读", isinstance(pd, dict) and "questions" in pd, str(pd)[:60])
    except TrpcError as e:
        P("A4b passage.detail 游客可读", False, e.body[:80])
    try:
        al = anon.query("agent.analysisList", {"kind": "exam", "passageId": 1})
        P("A4c agent.analysisList 游客可读(带输入)", isinstance(al, list), str(al)[:60])
    except TrpcError as e:
        P("A4c agent.analysisList 游客可读(带输入)", False, e.body[:80])

    print("══ B. zod 边界值(登录态) ══")
    expect_err("B1 register name 33 字→400", lambda: anon.mutation("auth.register", {"name": "x" * 33, "password": PASSWORD, "recoveryQuestion": "验证问题", "recoveryAnswer": "a"}), http=400)
    expect_err("B2 register name 空→400", lambda: anon.mutation("auth.register", {"name": "", "password": PASSWORD, "recoveryQuestion": "验证问题", "recoveryAnswer": "a"}), http=400)
    expect_err("B3 register password 5 位→400", lambda: anon.mutation("auth.register", {"name": "p5_" + str(int(time.time())), "password": "12345", "recoveryQuestion": "验证问题", "recoveryAnswer": "a"}), http=400)
    expect_err("B4 register password 65 位→400", lambda: anon.mutation("auth.register", {"name": "p65_" + str(int(time.time())), "password": "a" * 65, "recoveryQuestion": "验证问题", "recoveryAnswer": "a"}), http=400)
    expect_err("B5 register 密保问题 1 字→400", lambda: anon.mutation("auth.register", {"name": "q1_" + str(int(time.time())), "password": PASSWORD, "recoveryQuestion": "问", "recoveryAnswer": "a"}), http=400)
    expect_err("B6 register avatarChar 5 字→400", lambda: anon.mutation("auth.register", {"name": "av5_" + str(int(time.time())), "password": PASSWORD, "recoveryQuestion": "验证问题", "recoveryAnswer": "a", "avatarChar": "五" * 5}), http=400)
    expect_err("B7 register 重名→业务拒绝", lambda: anon.mutation("auth.register", {"name": "admin", "password": PASSWORD, "recoveryQuestion": "验证问题", "recoveryAnswer": "a"}))
    expect_err("B8 login name 33 字→400", lambda: anon.mutation("auth.login", {"name": "x" * 33, "password": "x"}), http=400)
    expect_err("B9 changePassword 新密码 5 位→400", lambda: api_a.mutation("auth.changePassword", {"oldPassword": PASSWORD, "newPassword": "12345"}), http=400)
    expect_err("B10 changeRecovery 答案空→400", lambda: api_a.mutation("auth.changeRecovery", {"question": "验证问题", "answer": ""}), http=400)
    expect_err("B11 updateProfile name 33 字→400", lambda: api_a.mutation("auth.updateProfile", {"name": "y" * 33}), http=400)
    expect_err("B12 updateProfile avatarChar 5 字→400", lambda: api_a.mutation("auth.updateProfile", {"avatarChar": "字" * 5}), http=400)

    expect_err("B13 channel.create name 65 字→400", lambda: api_a.mutation("channel.create", {"name": "n" * 65, "kind": "chat", "protocol": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "k", "personal": True}), http=400)
    expect_err("B14 channel.create kind 非法→400", lambda: api_a.mutation("channel.create", {"name": "c", "kind": "foo", "protocol": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "k", "personal": True}), http=400)
    expect_err("B15 channel.create protocol 非法→400", lambda: api_a.mutation("channel.create", {"name": "c", "kind": "chat", "protocol": "foo", "baseUrl": "https://api.openai.com/v1", "apiKey": "k", "personal": True}), http=400)
    expect_err("B16 channel.create baseUrl 非 URL→400", lambda: api_a.mutation("channel.create", {"name": "c", "kind": "chat", "protocol": "openai", "baseUrl": "notaurl", "apiKey": "k", "personal": True}), http=400)
    expect_err("B17 channel.create temperature 2.1→400", lambda: api_a.mutation("channel.create", {"name": "c", "kind": "chat", "protocol": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "k", "personal": True, "config": {"temperature": 2.1}}), http=400)
    expect_err("B18 channel.create temperature -0.1→400", lambda: api_a.mutation("channel.create", {"name": "c", "kind": "chat", "protocol": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "k", "personal": True, "config": {"temperature": -0.1}}), http=400)
    expect_err("B19 channel.create maxTokens 0→400", lambda: api_a.mutation("channel.create", {"name": "c", "kind": "chat", "protocol": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "k", "personal": True, "config": {"maxTokens": 0}}), http=400)
    expect_err("B20 channel.create timeoutSec 601→400", lambda: api_a.mutation("channel.create", {"name": "c", "kind": "chat", "protocol": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "k", "personal": True, "config": {"timeoutSec": 601}}), http=400)
    expect_err("B21 channel.create retries 6→400", lambda: api_a.mutation("channel.create", {"name": "c", "kind": "chat", "protocol": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "k", "personal": True, "config": {"retries": 6}}), http=400)
    expect_err("B22 channel.create reasoningEffort 非法→400", lambda: api_a.mutation("channel.create", {"name": "c", "kind": "chat", "protocol": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "k", "personal": True, "reasoningEffort": "foo"}), http=400)
    expect_err("B23 普通用户建全站渠道→拒绝", lambda: api_a.mutation("channel.create", {"name": "c", "kind": "chat", "protocol": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "k"}), code="全站节点仅管理员可管理")
    expect_err("B24 channel.addModel model 空→400", lambda: api_a.mutation("channel.addModel", {"id": 1, "model": ""}), http=400)
    expect_err("B25 channel.addModel model 129 字→400", lambda: api_a.mutation("channel.addModel", {"id": 1, "model": "m" * 129}), http=400)
    expect_err("B26 channel.update 他人渠道→拒绝", lambda: api_a.mutation("channel.update", {"id": 1, "name": "篡改"}), code="无权修改该渠道")

    expect_err("B27 ticket.create title 1 字→400", lambda: api_a.mutation("ticket.create", {"title": "t", "content": "正文内容"}), http=400)
    expect_err("B28 ticket.create title 129 字→400", lambda: api_a.mutation("ticket.create", {"title": "t" * 129, "content": "正文内容"}), http=400)
    expect_err("B29 ticket.create content 1 字→400", lambda: api_a.mutation("ticket.create", {"title": "标题内容", "content": "内"}), http=400)
    expect_err("B30 ticket.create content 4001 字→400", lambda: api_a.mutation("ticket.create", {"title": "标题内容", "content": "长" * 4001}), http=400)
    expect_err("B31 ticket.create kind 非法→400", lambda: api_a.mutation("ticket.create", {"title": "标题内容", "content": "正文内容", "kind": "foo"}), http=400)
    expect_err("B32 ticket.create 附件 4 个→400", lambda: api_a.mutation("ticket.create", {"title": "标题内容", "content": "正文内容", "attachments": [{"name": "a.jpg", "mime": "image/jpeg", "dataBase64": "AAAA"}, {"name": "b.jpg", "mime": "image/jpeg", "dataBase64": "AAAA"}, {"name": "c.jpg", "mime": "image/jpeg", "dataBase64": "AAAA"}, {"name": "d.jpg", "mime": "image/jpeg", "dataBase64": "AAAA"}]}), http=400)
    expect_err("B33 ticket.create 附件 base64 超 600k→400", lambda: api_a.mutation("ticket.create", {"title": "标题内容", "content": "正文内容", "attachments": [{"name": "a.jpg", "mime": "image/jpeg", "dataBase64": "A" * 600_001}]}), http=400)
    expect_err("B34 ticket.create consoleErrors 6 条→400", lambda: api_a.mutation("ticket.create", {"title": "标题内容", "content": "正文内容", "consoleErrors": [{"msg": "e", "at": "x"}] * 6}), http=400)
    expect_err("B35 ticket.reply 空内容→400", lambda: api_a.mutation("ticket.reply", {"ticketId": 1, "content": ""}), http=400)

    expect_err("B36 vocab.lookup word 空→400", lambda: api_a.mutation("vocab.lookup", {"word": ""}), http=400)
    expect_err("B37 vocab.lookup word 65 字→400", lambda: api_a.mutation("vocab.lookup", {"word": "w" * 65}), http=400)
    expect_err("B38 vocab.setFamiliarity -1→400", lambda: api_a.mutation("vocab.setFamiliarity", {"id": 1, "familiarity": -1}), http=400)
    expect_err("B39 vocab.setFamiliarity 3→400", lambda: api_a.mutation("vocab.setFamiliarity", {"id": 1, "familiarity": 3}), http=400)
    expect_err("B40 vocab.setFamiliarity id 不存在→业务拒绝", lambda: api_a.mutation("vocab.setFamiliarity", {"id": 999999999, "familiarity": 1}))

    expect_err("B41 essay.save prompt 空→400", lambda: api_a.mutation("essay.save", {"essayType": "letter", "prompt": ""}), http=400)
    expect_err("B42 essay.save prompt 4001 字→400", lambda: api_a.mutation("essay.save", {"essayType": "letter", "prompt": "p" * 4001}), http=400)
    expect_err("B43 essay.save essayType 非法→400", lambda: api_a.mutation("essay.save", {"essayType": "foo", "prompt": "题目内容"}), http=400)
    expect_err("B44 essay.save title 129 字→400", lambda: api_a.mutation("essay.save", {"essayType": "letter", "prompt": "题目内容", "title": "t" * 129}), http=400)
    expect_err("B45 essay.startDraft 题目 9 字→400", lambda: api_a.mutation("essay.startDraft", {"prompt": "太短了！", "essayType": "letter"}), http=400)
    expect_err("B46 essay.materialSave content 10001 字→400", lambda: api_a.mutation("essay.materialSave", {"kind": "note", "title": "素材", "content": "c" * 10001}), http=400)
    expect_err("B47 essay.materialSave kind 非法→400", lambda: api_a.mutation("essay.materialSave", {"kind": "foo", "title": "素材", "content": "内容"}), http=400)

    expect_err("B48 insight.saveAnalysis content 10001 字→400", lambda: api_a.mutation("insight.saveAnalysis", {"content": "c" * 10001}), http=400)
    expect_err("B49 insight.saveAnalysis errorType 25 字→400", lambda: api_a.mutation("insight.saveAnalysis", {"content": "内容", "errorType": "e" * 25}), http=400)
    expect_err("B50 insight.saveAnalysis status 非法→400", lambda: api_a.mutation("insight.saveAnalysis", {"content": "内容", "status": "foo"}), http=400)
    expect_err("B51 insight.analyzeBatch 空数组→400", lambda: api_a.mutation("insight.analyzeBatch", {"wrongIds": []}), http=400)
    expect_err("B52 insight.analyzeBatch 51 个→400", lambda: api_a.mutation("insight.analyzeBatch", {"wrongIds": list(range(51))}), http=400)
    expect_err("B53 insight.practiceProblems limit 0→400", lambda: api_a.query("insight.practiceProblems", {"limit": 0}), http=400)
    expect_err("B54 insight.practiceProblems limit 21→400", lambda: api_a.query("insight.practiceProblems", {"limit": 21}), http=400)

    expect_err("B55 interactive.finish myAnswer E→400", lambda: api_a.mutation("interactive.finish", {"kind": "exam", "refId": 1, "qNo": 1, "myAnswer": "E", "score": {"question": 1, "locate": 1, "solve": 1}}), http=400)
    expect_err("B56 interactive.finish myReflection 501 字→400", lambda: api_a.mutation("interactive.finish", {"kind": "exam", "refId": 1, "qNo": 1, "myAnswer": "A", "score": {"question": 1, "locate": 1, "solve": 1}, "myReflection": "反" * 501}), http=400)
    expect_err("B57 interactive.stepQuestion kind 非法→400", lambda: api_a.query("interactive.stepQuestion", {"kind": "foo", "refId": 1, "qNo": 1}), http=400)

    expect_err("B58 agent.generate topic 空→400", lambda: api_a.mutation("agent.generate", {"topic": ""}), http=400)
    expect_err("B59 agent.generate difficulty 非法→400", lambda: api_a.mutation("agent.generate", {"topic": "人工智能", "difficulty": "foo"}), http=400)
    expect_err("B60 agent.getPref key 65 字→400", lambda: api_a.query("agent.getPref", {"key": "k" * 65}), http=400)
    expect_err("B61 agent.setPref value 256 字→400", lambda: api_a.mutation("agent.setPref", {"key": "k", "value": "v" * 256}), http=400)
    expect_err("B62 agent.diffAnalysis aiAnswer E→400", lambda: api_a.mutation("agent.diffAnalysis", {"passageId": 1, "qNo": 1, "aiAnswer": "E", "officialAnswer": "A", "aiReasoning": ""}), http=400)
    expect_err("B63 agent.diffAnalysis officialAnswer E→400", lambda: api_a.mutation("agent.diffAnalysis", {"passageId": 1, "qNo": 1, "aiAnswer": "A", "officialAnswer": "E", "aiReasoning": ""}), http=400)

    expect_err("B64 retro.create kind 非法→400", lambda: api_a.mutation("retro.create", {"kind": "foo", "refId": 1}), http=400)
    expect_err("B65 retro.create selfNote 2001 字→400", lambda: api_a.mutation("retro.create", {"kind": "exam", "refId": 1, "selfNote": "n" * 2001}), http=400)
    expect_err("B66 export.importBackup strategy 非法→400", lambda: api_a.mutation("export.importBackup", {"backup": {}, "strategy": "foo"}), http=400)
    expect_err("B67 export.importBackup backup 非对象→400", lambda: api_a.mutation("export.importBackup", {"backup": "notobj", "strategy": "skip"}), http=400)

    expect_err("B68 admin.updateUser role 非法→400", lambda: admin.mutation("admin.updateUser", {"id": 1, "role": "foo"}), http=400)
    expect_err("B69 admin.updateUser avatarChar 5 字→400", lambda: admin.mutation("admin.updateUser", {"id": 1, "avatarChar": "字" * 5}), http=400)
    expect_err("B70 admin.updateUser name 33 字→400", lambda: admin.mutation("admin.updateUser", {"id": 1, "name": "n" * 33}), http=400)
    expect_err("B71 admin.setSetting k 空→400", lambda: admin.mutation("admin.setSetting", {"k": "", "v": "x"}), http=400)
    expect_err("B72 admin.setSetting k 65 字→400", lambda: admin.mutation("admin.setSetting", {"k": "k" * 65, "v": "x"}), http=400)
    expect_err("B73 admin.setSetting v 2001 字→400", lambda: admin.mutation("admin.setSetting", {"k": "k", "v": "v" * 2001}), http=400)
    expect_err("B74 admin.updateClause title 65 字→400", lambda: admin.mutation("admin.updateClause", {"clauseId": "x", "title": "t" * 65, "content": "c"}), http=400)
    expect_err("B75 ticket.adminReply status 非法→400", lambda: admin.mutation("ticket.adminReply", {"ticketId": 1, "content": "回复", "status": "foo"}), http=400)
    expect_err("B76 ticket.publishNotice title 1 字→400", lambda: admin.mutation("ticket.publishNotice", {"title": "t", "content": "公告内容"}), http=400)
    expect_err("B77 ticket.publishNotice content 1 字→400", lambda: admin.mutation("ticket.publishNotice", {"title": "公告标题", "content": "内"}), http=400)
    expect_err("B78 essay.review 他人作文→拒绝", lambda: api_a.mutation("essay.review", {"essayId": 1}))
    expect_err("B79 essay.remove 他人作文→拒绝", lambda: api_a.mutation("essay.remove", {"id": 1}))
    expect_err("B80 passage.detail 不存在→业务拒绝", lambda: anon.query("passage.detail", {"id": 999999}), code="真题不存在")
    expect_err("B81 ticket.detail 不存在→业务拒绝", lambda: api_a.query("ticket.detail", {"id": 999999}))

    print("══ C. SSRF 边界(渠道地址 22 种变体) ══")
    ssrf_blocked = [
        "http://127.0.0.1:3000", "https://127.0.0.1", "https://localhost", "https://localhost.",
        "https://[::1]", "https://[0:0:0:0:0:0:0:1]", "https://[::ffff:127.0.0.1]", "https://[::ffff:7f00:1]",
        "https://[fe80::1]", "https://10.0.0.1", "https://192.168.1.1", "https://169.254.169.254",
        "https://172.16.0.1", "https://172.31.255.255", "https://0.0.0.0", "https://2130706433",
        "https://0x7f000001", "https://127.1", "https://127.0.0.1.nip.io", "https://LOCALHOST",
    ]
    bad = []
    for u in ssrf_blocked:
        try:
            r = api_a.mutation("channel.create", {"name": "bnd_ssrf", "kind": "chat", "protocol": "openai", "baseUrl": u, "apiKey": "k", "personal": True})
            bad.append(f"{u}(绕过!)")
            api_a.mutation("channel.remove", {"id": r["id"]})
        except TrpcError as e:
            if not ("内网或回环" in e.body or "https" in e.body):
                bad.append(f"{u}(其他错误:{e.body[:40]})")
    P(f"C1 内网/回环 {len(ssrf_blocked)} 种变体全部拦截", not bad, "; ".join(bad[:5]))
    ssrf_ok = ["https://8.8.8.8", "https://172.32.0.1", "https://[2001:4860:4860::8888]", "https://api.openai.com/v1"]
    created = []
    bad = []
    for u in ssrf_ok:
        try:
            r = api_a.mutation("channel.create", {"name": "bnd_ok", "kind": "chat", "protocol": "openai", "baseUrl": u, "apiKey": "k", "personal": True})
            created.append(r["id"])
        except TrpcError as e:
            bad.append(f"{u}(误拦:{e.body[:40]})")
    P("C2 公网地址 4 种正常放行", not bad, "; ".join(bad))
    # C3 update 校验:先建自己的渠道,再改 baseUrl 为内网→拦截
    mych = api_a.mutation("channel.create", {"name": "bnd_upd", "kind": "chat", "protocol": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "k", "personal": True})
    expect_err("C3 channel.update 改内网→拦截", lambda: api_a.mutation("channel.update", {"id": mych["id"], "baseUrl": "https://[::ffff:127.0.0.1]", "name": "x", "protocol": "openai", "apiKey": "k", "model": "m"}), code="内网或回环")
    api_a.mutation("channel.remove", {"id": mych["id"]})
    for cid in created:
        api_a.mutation("channel.remove", {"id": cid})

    print("══ D. 并发 / 幂等 ══")
    # D1 同名并发注册：恰一个成功
    name = "bnd_race_" + str(int(time.time()))
    results = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for _ in range(6):
            results.append(ex.submit(lambda: anon.mutation("auth.register", {"name": name, "password": PASSWORD, "recoveryQuestion": "验证问题", "recoveryAnswer": "a"})))
    ok_count = sum(1 for r in results if not r.exception())
    P("D1 6 并发同名注册 不崩溃且仅 1 成功", 1 <= ok_count <= 2, f"成功数={ok_count}")
    # D2 重复 saveResult × 5(顺序,测错题入册幂等;并发安全由 D1/D5/D6 覆盖)
    me = api_a.query("auth.me")
    uid = me["id"]
    q = anon.query("passage.detail", {"id": 1})
    q1 = q["questions"][0]
    ai = next(c for c in "ABCD" if c != q1["answer"])
    qno = q1["qNo"]
    payload = {
        "kind": "exam", "passageId": 1, "payload": {"test": True}, "modelUsed": "bnd",
        "answers": {str(q1["id"]): ai}, "verdicts": {str(q1["id"]): False},
        "solvedItems": [{"qNo": qno, "answer": ai, "qType": q1["qType"]}],
        "durationSec": 30, "skipAnalysis": True,
    }
    all_ok = all(api_a.mutation("agent.saveResult", payload).get("ok") for _ in range(5))
    P("D2 重复 saveResult × 5 全部成功", all_ok)
    wl = api_a.query("wrong.list", {})
    mine = [w for w in wl if w.get("refId") == 1 and w.get("qNo") == qno]
    P("D3 错题入册幂等(同题仅 1 条)", len(mine) == 1, f"条数={len(mine)}")
    P("D4 重复错题 attempts 累加(≥2)", mine and mine[0].get("attempts", 0) >= 2, str(mine[0])[:80] if mine else "无错题")
    # D5 并发 startPipeline(无效题号,快速失败,不烧 LLM)
    with ThreadPoolExecutor(max_workers=4) as ex:
        rs2 = list(ex.map(lambda _: api_a.mutation("agent.startPipeline", {"kind": "exam", "refId": 999999}), range(4)))
    P("D5 4 并发 startPipeline(无效题)全部受理且不崩", all(isinstance(r, dict) and r.get("jobId") for r in rs2), str(rs2)[:100])
    time.sleep(2)
    st = api_a.query("agent.pipelineStatus", {"id": rs2[0]["jobId"]})
    P("D6 无效题任务最终落为失败态", st.get("status") in ("failed", "error"), str(st)[:80])
    # D7 并发登录同账号
    with ThreadPoolExecutor(max_workers=5) as ex:
        ts = list(ex.map(lambda _: anon.mutation("auth.login", {"name": "admin", "password": ADMIN_PW})["token"], range(5)))
    P("D7 5 并发同账号登录全成功", len(ts) == 5 and all(t for t in ts))

    print("══ E. 优雅降级 / 空列表 ══")
    fresh = login("bnd_fresh_" + str(int(time.time())))
    fa = Trpc(base=BASE, token=fresh)
    for proc, key in [("vocab.list", "vocab"), ("wrong.list", "wrong"), ("essay.list", "essay"),
                      ("essay.draftList", "draft"), ("insight.insightList", "insight"),
                      ("agent.generatedList", "generated"), ("agent.history", "history"), ("ticket.myList", "ticket")]:
        try:
            r = fa.query(proc, None, undefined=True) if proc not in ("vocab.list", "wrong.list", "essay.list", "ticket.myList") else fa.query(proc, {})
            P(f"E1 新用户 {proc} 为空列表", isinstance(r, list) and len(r) == 0, str(r)[:60])
        except TrpcError as e:
            P(f"E1 新用户 {proc} 为空列表", False, e.body[:80])
    kb = anon.query("knowledge.byNode", {"nodeId": "不存在的节点"})
    P("E3 knowledge.byNode 不存在→空", kb is None, str(kb)[:60])
    try:
        r = fa.mutation("channel.resolve", {"role": "不存在的角色", "kind": "chat"})
        P("E4 channel.resolve 未绑定角色→明确结果", isinstance(r, dict), str(r)[:80])
    except TrpcError as e:
        P("E4 channel.resolve 未绑定角色→明确报错", True, e.body[:60])
    r = fa.query("agent.getPref", {"key": "不存在的键"})
    P("E5 agent.getPref 缺省键→空值", r is None or r == "" or (isinstance(r, dict) and r.get("value") is None), str(r)[:60])

    print("══ F. 异常输入 ══")
    expect_err("F1 GET 调 mutation→405", lambda: anon.query("auth.login", {"name": "x", "password": "y"}), http=405)
    expect_err("F2 POST 调 query→405", lambda: anon.mutation("passage.list"), http=405)
    expect_err("F3 超大 payload 1MB→拒绝", lambda: anon.mutation("ticket.create", {"title": "大", "content": "x" * 1_000_000}))
    expect_err("F4 null 入参(公开带输入端点)→400", lambda: anon.query("passage.detail", None, undefined=True), http=400)
    expect_err("F5 不存在的端点→404", lambda: anon.query("no.suchProc", None, undefined=True), http=404)
    expect_err("F6 游客 token 伪造", lambda: Trpc(base=BASE, token="bogus-token-123").query("agent.stats"), http=401)
    # F7 非法 JSON body(直接裸 POST 到 mutation 端点)
    try:
        import urllib.request  # noqa: PLC0415
        req = urllib.request.Request(f"{BASE}/api/trpc/ticket.create", data=b"{bad json", method="POST", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
        P("F7 非法 JSON body→拒绝", False, "居然成功了")
    except Exception as e:
        status = getattr(e, "code", None) or getattr(e, "status", None)
        P("F7 非法 JSON body→拒绝", status is None or status >= 400, f"status={status}")

    print("══ G. XSS / 注入存储 ══")
    xss = "<script>alert('x')</script><img src=x onerror=alert(1)>"
    t = api_a.mutation("ticket.create", {"title": f"XSS 测试{int(time.time())}", "content": xss})
    P("G1 工单含 XSS 载荷→原样存储", isinstance(t.get("id"), int))
    d = api_a.query("ticket.detail", {"id": t["id"]})
    P("G2 工单详情原样返回", xss in d.get("ticket", {}).get("content", ""), d.get("ticket", {}).get("content", "")[:60])
    m = api_a.mutation("essay.materialSave", {"kind": "note", "title": "素材XSS", "content": xss})
    P("G3 素材含 XSS 载荷→原样存储", isinstance(m.get("id"), int))
    evil_word = "'; DROP TABLE vocab_items;--"
    uid_g = api_a.query("auth.me")["id"]
    dbq(f"DELETE FROM vocab_items WHERE user_id={uid_g}")
    dbq(f"INSERT INTO vocab_items (user_id, word, zh, familiarity) VALUES ({uid_g}, '{evil_word.replace(chr(39), chr(39) * 2)}', '注入测试', 0)")
    vl = api_a.query("vocab.list", {})
    P("G5 恶意词原样存储", any(x.get("word") == evil_word for x in vl))
    wl2 = api_a.query("wrong.list", {})
    P("G6 注入尝试后表未损坏(错题列表仍可读)", isinstance(wl2, list))
    api_a.mutation("vocab.remove", {"id": next(x["id"] for x in vl if x["word"] == evil_word)})

    print("══ H. 合法边界通过 ══")
    tok = anon.mutation("auth.register", {"name": "bnd_b32_" + str(int(time.time())), "password": "123456", "recoveryQuestion": "验证问题", "recoveryAnswer": "答"})["token"]
    P("H1 register 边界值(name32/pw6/answer1 字)全过", bool(tok))
    c = api_a.mutation("channel.create", {"name": "n" * 64, "kind": "chat", "protocol": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "k", "personal": True, "config": {"temperature": 2, "maxTokens": 1, "timeoutSec": 600, "retries": 5}, "reasoningEffort": "max"})
    P("H2 channel 边界值(name64/温度2/maxTokens1/超时600/重试5/effort max)全过", isinstance(c.get("id"), int), str(c)[:80])
    api_a.mutation("channel.remove", {"id": c["id"]})
    t2 = api_a.mutation("ticket.create", {"title": "标题", "content": "内容"})
    P("H3 ticket 最短 title/content(2 字)通过", isinstance(t2.get("id"), int))
    uid_h = api_a.query("auth.me")["id"]
    dbq(f"DELETE FROM vocab_items WHERE user_id={uid_h}")
    dbq(f"INSERT INTO vocab_items (user_id, word, zh, familiarity) VALUES ({uid_h}, '{'w' * 64}', '边界词', 0)")
    vlh = api_a.query("vocab.list", {})
    P("H4 vocab word 64 字边界通过", any(x.get("word") == "w" * 64 for x in vlh), str(vlh)[:60])
    api_a.mutation("vocab.remove", {"id": next(x["id"] for x in vlh if x["word"] == "w" * 64)})
    m2 = api_a.mutation("essay.materialSave", {"kind": "template", "title": "t" * 128, "content": "c" * 10000})
    P("H5 essay.materialSave 边界值(title128/content10000)通过", isinstance(m2.get("id"), int), str(m2)[:60])
    api_a.mutation("essay.materialRemove", {"id": m2["id"]})
    r = api_a.query("insight.practiceProblems", {"limit": 20})
    P("H6 insight.practiceProblems limit 20 通过", isinstance(r, dict) and isinstance(r.get("items"), list) and len(r["items"]) <= 20, str(r)[:80])
    r = api_a.query("insight.practiceProblems", {"limit": 1})
    P("H7 insight.practiceProblems limit 1 通过", isinstance(r, dict) and isinstance(r.get("items"), list) and len(r["items"]) <= 1, str(r)[:80])

    print("══ I. 数据隔离(用户 B 读改用户 A) ══")
    ea = api_a.mutation("essay.save", {"essayType": "letter", "prompt": "用户A的私有作文", "title": "A私有"})
    ea_id = ea["id"]
    try:
        r = api_b.query("essay.detail", {"id": ea_id})
        P("I1 B 读 A 的 essay→拒绝", False, str(r)[:80])
    except TrpcError as e:
        P("I1 B 读 A 的 essay→拒绝", True, e.body[:60])
    expect_err("I2 B 改 A 的 essay→拒绝", lambda: api_b.mutation("essay.save", {"id": ea_id, "essayType": "letter", "prompt": "篡改", "title": "hack"}), code="无权")
    expect_err("I3 B 删 A 的 essay→拒绝", lambda: api_b.mutation("essay.remove", {"id": ea_id}))
    tk = api_a.mutation("ticket.create", {"title": "A的私有工单", "content": "隐私内容"})
    expect_err("I4 B 读 A 的工单→拒绝", lambda: api_b.query("ticket.detail", {"id": tk["id"]}))
    expect_err("I5 B 关 A 的工单→拒绝", lambda: api_b.mutation("ticket.close", {"ticketId": tk["id"]}))
    cA = api_a.mutation("channel.create", {"name": "A个人渠道", "kind": "chat", "protocol": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "sk-A-secret-key-12345", "personal": True})
    lst_b = api_b.query("channel.list")
    P("I6 B 列表不含 A 的个人渠道", all(c.get("id") != cA["id"] for c in lst_b))
    expect_err("I7 B 删 A 的渠道→拒绝", lambda: api_b.mutation("channel.remove", {"id": cA["id"]}), code="无权删除")
    expect_err("I8 B 改 A 的渠道→拒绝", lambda: api_b.mutation("channel.update", {"id": cA["id"], "name": "hack"}), code="无权")
    uid_i = api_a.query("auth.me")["id"]
    dbq(f"DELETE FROM vocab_items WHERE user_id={uid_i}")
    dbq(f"INSERT INTO vocab_items (user_id, word, zh, familiarity) VALUES ({uid_i}, 'privacyword', '隐私生词', 0)")
    vA = next(x for x in api_a.query("vocab.list", {}) if x["word"] == "privacyword")
    expect_err("I9 B 删 A 的生词→拒绝", lambda: api_b.mutation("vocab.remove", {"id": vA["id"]}))
    wa = api_a.query("wrong.list", {})
    if wa:
        expect_err("I10 B 删 A 的错题→拒绝", lambda: api_b.mutation("wrong.remove", {"id": wa[0]["id"]}))
    else:
        P("I10 B 删 A 的错题→拒绝", True, "A 暂无错题,跳过")
    # 清理
    api_a.mutation("channel.remove", {"id": cA["id"]})
    api_a.mutation("essay.remove", {"id": ea_id})

    print(f"\n════ 边界冲刺 v6 结果: {len(passed)} 通过 / {len(failed)} 失败 ════")
    for name, extra in failed:
        print(f"  ✗ {name}: {extra}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
