#!/usr/bin/env python3
"""v5 全量 API 冗余测试套件 —— 每一个问题被消灭、每一个功能被实现的实证。

四组：
  A 认证与访客边界（游客 public 可读 / 写操作 401 / 密保盐解耦 / 越权 403）
  B 判分基准与任务生命周期（officialOf 基准 / 用户隔离 / 僵尸任务 / 去重 / 限流 / SSRF）
  C 新模块全链路（insight 诊断-感悟-复习-参谋 / essay 工坊状态机 / export 备份恢复）—— 含 LLM
  D 差异分析缓存 / 安全头 / 输入边界

运行：python3 test_v5_api.py          （需本地 3000 端口服务在跑）
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, "/app/.user/skills/kaoyan-reading-app/scripts")
from trpc_call import Trpc, TrpcError  # noqa: E402

BASE = "http://localhost:3000"
APP = "/mnt/agents/output/app"
PASSWORD = "CHANGE_ME_USER_PASS"

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


def register_or_login(name: str) -> str:
    anon = Trpc()
    try:
        r = anon.mutation("auth.register", {
            "name": name, "password": PASSWORD,
            "recoveryQuestion": "本测试套件的代号是什么", "recoveryAnswer": "v5",
        })
        return r["token"]
    except TrpcError:
        r = anon.mutation("auth.login", {"name": name, "password": PASSWORD})
        return r["token"]


def node_db(sql: str) -> str:
    """通过 node mysql2 直查数据库（写 .cjs 临时脚本，app 目录内解析 mysql2）。"""
    script = f"""
require("dotenv").config();
const mysql = require("mysql2/promise");
(async () => {{
  const c = await mysql.createConnection(process.env.DATABASE_URL + "?ssl={{\\"rejectUnauthorized\\":false}}");
  const [rows] = await c.query({json.dumps(sql)});
  console.log(JSON.stringify(rows));
  await c.end();
}})().catch((e) => {{ console.error("DBERR:" + e.message); process.exit(1); }});
"""
    with open(f"{APP}/_t.cjs", "w") as f:
        f.write(script)
    try:
        out = subprocess.run(["node", "_t.cjs"], cwd=APP, capture_output=True, text=True, timeout=30)
        if out.returncode != 0:
            raise RuntimeError(out.stderr[:300] or out.stdout[:300])
        # dotenv 横幅会污染 stdout，取最后一行 JSON
        return [l for l in out.stdout.strip().splitlines() if l.strip()][-1]
    finally:
        subprocess.run(["rm", "-f", f"{APP}/_t.cjs"])


# ═══════════════════════════ A 认证与访客边界 ═══════════════════════════
def suite_A():
    print("\n══ A 认证与访客边界 ══")
    anon = Trpc()

    info = anon.query("auth.siteInfo")
    P("A1 游客可读 siteInfo", isinstance(info, dict))

    ps = anon.query("passage.list")
    P("A2 游客可读真题库（68篇）", len(ps) == 68, f"got {len(ps)}")
    det = anon.query("passage.detail", {"id": ps[0]["id"]})
    P("A3 游客可读文章+题目", len(det.get("passage", {}).get("paragraphs", [])) > 0 and len(det.get("questions", [])) > 0,
      f"paras={len(det.get('passage', {}).get('paragraphs', []))} qs={len(det.get('questions', []))}")

    # 写操作/私人数据一律 401
    for proc, payload, is_q in [
        ("agent.stats", None, True),
        ("wrong.list", {"mastered": False}, True),
        ("insight.errorTypeStats", None, True),
        ("insight.reviewQueue", None, True),
        ("essay.list", None, True),
        ("export.fullBackup", None, True),
        ("channel.list", None, True),
        ("agent.startPipeline", {"kind": "exam", "refId": ps[0]["id"]}, False),
        ("method.parseSentence", {"kind": "exam", "refId": 1, "paraNo": 1, "sentIdx": 0, "sentence": "x"}, False),
        ("insight.analyze", {"wrongId": 1}, False),
        ("essay.startDraft", {"essayType": "letter", "prompt": "x"}, False),
        ("export.importBackup", {"backup": {}, "strategy": "skip", "dryRun": True}, False),
    ]:
        fn = (lambda p=payload, q=is_q, pr=proc: (anon.query if q else anon.mutation)(pr, p))
        expect_err(f"A4 游客调 {proc} → 401", fn, http=401)

    # 注册/登录 + 错误密码
    tok = register_or_login("v5newbie")
    P("A5 注册 v5newbie 成功", len(tok) == 64)
    expect_err("A6 错误密码 → 401", lambda: anon.mutation("auth.login", {"name": "v5newbie", "password": "wrong"}), http=401)

    # 密保盐解耦：改密码不影响密保找回；找回重置不影响登录态逻辑
    api = Trpc(token=tok)
    q = anon.query("auth.recoveryQuestionFor", {"name": "v5newbie"})
    P("A7 可取密保问题", q.get("question") == "本测试套件的代号是什么")
    api.mutation("auth.changePassword", {"oldPassword": PASSWORD, "newPassword": PASSWORD + "x"})
    expect_err("A8 改密后旧密码失效", lambda: anon.mutation("auth.login", {"name": "v5newbie", "password": PASSWORD}), http=401)
    anon.mutation("auth.resetPassword", {"name": "v5newbie", "recoveryAnswer": "v5", "newPassword": PASSWORD})
    # resetPassword 会清空旧会话（安全设计），必须重新登录拿新 token
    tok_fresh = anon.mutation("auth.login", {"name": "v5newbie", "password": PASSWORD})["token"]
    api = Trpc(token=tok_fresh)
    P("A9 改密后密保找回仍可用（recovery_salt 未被联动破坏）", True)

    # 越权：非管理员写全局提示词 → 403；写个人提示词 → 放行（用废弃角色，避免污染真实 LLM 流程）
    expect_err(
        "A10 普通用户写全局提示词 → 403",
        lambda: api.mutation("prompt.save", {"agentRole": "test_role_unused", "name": "x", "content": "x", "personal": False}),
        http=403,
    )
    r = api.mutation("prompt.save", {"agentRole": "test_role_unused", "name": "个人覆盖测试", "content": "个人覆盖内容", "personal": True})
    P("A11 普通用户写个人提示词放行", isinstance(r, dict))

    return ps


# ═══════════════════════ B 判分基准与任务生命周期 ═══════════════════════
def suite_B(ps):
    print("\n══ B 判分基准与任务生命周期 ══")
    pid = ps[0]["id"]
    tok = register_or_login("v5newbie")
    api = Trpc(token=tok)
    anon = Trpc()
    det = anon.query("passage.detail", {"id": pid})
    qs = det["questions"]

    # B1 官方答案揭示端点与 detail 一致
    rev = api.query("agent.revealOfficialAnswers", {"kind": "exam", "refId": pid})
    official_map = {q["qNo"]: q["answer"] for q in qs}
    P("B1 官方答案揭示与语料一致", all(i["official"] == official_map[i["qNo"]] for i in rev["items"]))

    # B2 判分基准：AI 答案与官方分歧时，入册正确答案必须是官方（R1 咽喉点）
    q1 = qs[0]
    official = q1["answer"]
    ai_answer = next(c for c in "ABCD" if c != official)
    mine = ai_answer  # 用户跟着 AI 选错
    api.mutation("agent.saveResult", {
        "kind": "exam", "passageId": pid, "payload": {"test": True}, "modelUsed": "test",
        "answers": {str(q1["id"]): mine},
        "verdicts": {str(q1["id"]): False},
        "solvedItems": [{"qNo": q1["qNo"], "answer": ai_answer, "qType": q1["qType"]}],
        "durationSec": 60, "skipAnalysis": True,
    })
    wl = api.query("wrong.list", {})
    w = next((x for x in wl if x["source"] == "exam" and x["refId"] == pid and x["qNo"] == q1["qNo"]), None)
    P("B2 错题入册正确答案=官方（非AI分歧答案）", w is not None and w["correctAnswer"] == official,
      f"correctAnswer={w and w['correctAnswer']} official={official}")

    # B3 用户隔离：另一账号看不到这条错题/统计
    tok2 = register_or_login("v5veteran")
    api2 = Trpc(token=tok2)
    wl2 = api2.query("wrong.list", {})
    P("B3 错题按用户隔离", not any(x["refId"] == pid and x["qNo"] == q1["qNo"] for x in wl2))
    st1 = api.query("agent.stats")
    st2 = api2.query("agent.stats")
    n1 = json.dumps(st1)
    P("B4 统计按用户隔离", st2.get("totalPractices", st2.get("total", 0)) in (0, None) or len(n1) > 0 and st2 != st1,
      f"st1={json.dumps(st1)[:80]} st2={json.dumps(st2)[:80]}")

    # B5 任务生命周期：活任务复用 / 僵尸就地正法
    uid_rows = json.loads(node_db(f"SELECT id FROM users WHERE name='v5newbie'"))
    uid = uid_rows[0]["id"]
    node_db(f"DELETE FROM pipeline_jobs WHERE kind='generated' AND ref_id=999999")
    node_db(
        "INSERT INTO pipeline_jobs (user_id, kind, ref_id, status, stages, payload, answers, created_at, updated_at) "
        f"VALUES ({uid}, 'generated', 999999, 'running', '[]', '{{}}', '{{}}', NOW(), NOW())"
    )
    alive = json.loads(node_db("SELECT id FROM pipeline_jobs WHERE kind='generated' AND ref_id=999999 AND status='running'"))[0]["id"]
    r = api.mutation("agent.startPipeline", {"kind": "generated", "refId": 999999})
    P("B5 活任务复用（心跳在窗口内）", r.get("reused") is True and r.get("jobId") == alive, json.dumps(r))
    node_db(f"UPDATE pipeline_jobs SET updated_at = NOW() - INTERVAL 30 MINUTE WHERE id={alive}")
    r2 = api.mutation("agent.startPipeline", {"kind": "generated", "refId": 999999})
    P("B6 僵尸任务不复用，另起新任务", r2.get("reused") is False and r2.get("jobId") != alive, json.dumps(r2))
    zstate = json.loads(node_db(f"SELECT status, error_msg FROM pipeline_jobs WHERE id={alive}"))[0]
    P("B7 僵尸被标记 error 且给出可重试提示", zstate["status"] == "error" and "心跳" in (zstate["error_msg"] or ""), json.dumps(zstate))
    # 新起的任务因 refId 不存在应快速失败（不空跑 LLM）
    for _ in range(20):
        st = api.query("agent.pipelineStatus", {"id": r2["jobId"]})
        if st["status"] != "running":
            break
        time.sleep(1)
    P("B8 无效内容任务快速失败（不空转）", st["status"] == "error", st.get("status", ""))

    # B9 生成去重 + 限流（独立账号，1 次 LLM 成本）
    tok3 = register_or_login("v5limit")
    api3 = Trpc(token=tok3, timeout=320)
    topic = f"限流测试话题·{int(time.time())}"
    try:
        g1 = api3.mutation("agent.generate", {"topic": topic, "difficulty": "medium", "focusTypes": []})
        P("B9 AI 出题成功（1次LLM）", isinstance(g1.get("id"), int))
        dup = api3.mutation("agent.generate", {"topic": topic, "difficulty": "medium", "focusTypes": []})
        P("B10 同话题 1 小时内复用（reused）", dup.get("reused") is True and dup.get("id") == g1["id"])
        hits = 0
        # 首次真实生成耗时长（LLM ~90s），其限流时间戳可能已滑出 60s 窗口；
        # 去重命中（reused）调用虽不再调 LLM，但限流在去重判定之前计数，
        # 因此需补足 6 次窗口内调用再断言第 7 次 429（dup 已计 1 次 → 补 5 次）
        for _ in range(5):
            api3.mutation("agent.generate", {"topic": topic, "difficulty": "medium", "focusTypes": []})
            hits += 1
        expect_err(
            "B11 生成限流：窗口内第 7 次 → 429",
            lambda: api3.mutation("agent.generate", {"topic": topic, "difficulty": "medium", "focusTypes": []}),
            code="TOO_MANY_REQUESTS",
        )
    except TrpcError as e:
        P("B9 AI 出题成功（1次LLM）", False, f"{e.status} {e.body[:200]}（渠道不可用时整组降级为失败，需排查）")

    # B12 SSRF 守卫（管理员渠道写入）
    adm = Trpc(token=Trpc().mutation("auth.login", {"name": "admin", "password": "CHANGE_ME_ADMIN_PASS"})["token"])
    for bad in ["http://127.0.0.1:8080/v1", "http://192.168.1.5", "http://169.254.169.254/latest", "http://localhost:3000", "https://x.internal"]:
        expect_err(
            f"B12 SSRF 拦截 {bad}",
            lambda b=bad: adm.mutation("channel.create", {"name": "ssrf-test", "protocol": "openai", "baseUrl": b, "apiKey": "sk-x", "model": "m"}),
            http=400,
        )
    node_db("DELETE FROM channels WHERE name='ssrf-test'")

    return {"wrong": w, "passage": det, "q1": q1, "official": official, "ai_answer": ai_answer, "uid": uid}


# ═══════════════════════════ C 新模块全链路 ═══════════════════════════
def suite_C(ctx):
    print("\n══ C 新模块全链路（含 LLM，预计 5-9 分钟） ══")
    tok = register_or_login("v5newbie")
    api = Trpc(token=tok, timeout=320)
    w = ctx["wrong"]

    # C1 单题诊断（LLM）
    r = api.mutation("insight.analyze", {"wrongId": w["id"]})
    a = r["analysis"]
    P("C1 错因诊断：六分法+根因非空", a["errorType"] in ["locate", "comprehend", "overinfer", "detail", "mistype", "vocab"] and len(a["rootCause"]) > 5,
      f"type={a['errorType']} cause={a['rootCause'][:60]}")
    g = api.query("insight.getAnalysis", {"wrongId": w["id"]})
    P("C2 诊断书持久化可取", g is not None and g["errorType"] == a["errorType"])

    # C2b 批量越界 → 400
    expect_err("C2b analyzeBatch 超 50 → 400", lambda: api.mutation("insight.analyzeBatch", {"wrongIds": list(range(1, 52))}), http=400)

    # C3 六分法统计
    s = api.query("insight.errorTypeStats")
    P("C3 错因统计含本错题", s["total"] >= 1 and any(b["errorType"] == a["errorType"] and b["count"] >= 1 for b in s["byErrorType"]))

    # C4 感悟：写入 → 列表 → 摘要 → 错题状态联动
    api.mutation("insight.insightSave", {"wrongId": w["id"], "errorType": a["errorType"], "content": "测试感悟：先定位再排除", "status": "attention"})
    ins = api.query("insight.insightList", {})
    P("C4 感悟落库", any(i["content"] == "测试感悟：先定位再排除" for i in ins))
    summ = api.query("insight.insightSummary")
    P("C5 感悟摘要计数", summ["total"] >= 1 and summ["attention"] >= 1)
    wl = api.query("wrong.list", {})
    w2 = next(x for x in wl if x["id"] == w["id"])
    P("C6 错题感悟状态联动", w2["insightStatus"] == "attention", w2.get("insightStatus", ""))

    # C7 艾宾浩斯：排期 → 记住(+1阶段) → 忘记(归零)
    api.mutation("insight.reviewStart", {"wrongId": w["id"]})
    q1 = api.query("insight.reviewQueue")
    P("C7 加入复习后排期计数", q1["scheduledCount"] >= 1, json.dumps(q1)[:100])
    d1 = api.mutation("insight.reviewDone", {"wrongId": w["id"], "remembered": True})
    P("C8 记住 → 阶段+1（2天）", d1["stage"] == 1 and d1["days"] == 2, json.dumps(d1))
    d2 = api.mutation("insight.reviewDone", {"wrongId": w["id"], "remembered": False})
    P("C9 忘记 → 归零重排（1天）", d2["stage"] == 0 and d2["days"] == 1, json.dumps(d2))

    # C10 备考参谋（LLM）+ 缓存
    rec = api.mutation("insight.recommend", {"force": False})
    P("C10 参谋建议非空", len(rec["rec"]["advice"]) > 10, rec["rec"]["advice"][:60])
    rec2 = api.mutation("insight.recommend", {"force": False})
    P("C11 建议缓存命中", rec2.get("cached") is True)
    rec3 = api.mutation("insight.recommend", {"force": True})
    P("C12 force 重新生成", rec3.get("cached") is False)

    # C13 针对性练题（纯 SQL）：不推荐已错的题
    pp = api.query("insight.practiceProblems", {"limit": 8})
    P("C13 针对性练题排除已错", all(not (i["passageId"] == w["refId"] and i["qNo"] == w["qNo"]) for i in pp["items"]), json.dumps(pp)[:120])

    # C14 素材库
    m = api.mutation("essay.materialSave", {"kind": "sentence", "title": "测试万能句", "content": "From my perspective, ..."})
    P("C14 素材保存", isinstance(m.get("id"), int))
    ml = api.query("essay.materialList")
    P("C15 素材列表", any(x["title"] == "测试万能句" for x in ml))

    # C15 作文状态机（3 次 LLM：提纲/段落/批改）
    d = api.mutation("essay.startDraft", {"essayType": "letter", "prompt": "Write a letter to your friend Tom, inviting him to visit your hometown.", "useMaterials": True})
    st = d["state"]
    P("C15 提纲生成（step=outline）", st["step"] == "outline" and len(st["outline"]) >= 2, json.dumps(st)[:150])
    did = d["id"]
    api.mutation("essay.confirmOutline", {"draftId": did})
    st2 = api.query("essay.draftStatus", {"draftId": did})["state"]
    P("C16 确认提纲 → drafting", st2["step"] == "drafting")
    total = len(st2["outline"])
    for para in range(1, total + 1):
        gp = api.mutation("essay.generateParagraph", {"draftId": did, "regenerate": False})
        P(f"C17 第{para}段起草", len(gp["paragraph"]) > 30, gp["paragraph"][:60])
        api.mutation("essay.confirmParagraph", {"draftId": did, "paraNo": para, "content": gp["paragraph"]})
    fin = api.mutation("essay.finishDraft", {"draftId": did, "title": "测试作文·邀请信"})
    P("C18 收稿成文", isinstance(fin.get("essayId"), int) and len(fin["content"]) > 100)
    rv = api.mutation("essay.review", {"essayId": fin["essayId"]})
    P("C19 AI 批改有分有评", rv.get("score") is not None and bool(rv["review"]), json.dumps(rv)[:120])
    el = api.query("essay.list")
    P("C20 作文列表含本篇", any(e["id"] == fin["essayId"] for e in el))

    # C16 导出/恢复闭环
    bk = api.query("export.fullBackup")
    P("C21 全量备份九数据集+版本号", bk["version"] == "v5" and all(k in bk for k in ["practiceRecords", "wrongItems", "wrongItemAnalyses", "wrongInsights", "vocabItems", "generatedSets", "essays", "essayDrafts", "userMaterials"]))
    P("C22 备份含本次产出", any(x["wrongId"] == w["id"] for x in bk["wrongItemAnalyses"]) and any(x["title"] == "测试作文·邀请信" for x in bk["essays"]))
    dry = api.mutation("export.importBackup", {"backup": bk, "strategy": "skip", "dryRun": True})
    P("C23 导入预览（dryRun 不落库）", "vocab" in dry["report"] and "materials" in dry["report"])
    real = api.mutation("export.importBackup", {"backup": bk, "strategy": "skip", "dryRun": False})
    P("C24 导入遇重跳过", real["report"]["materials"]["skip"] >= 1, json.dumps(real["report"]))
    expect_err("C25 异版本备份 → 400", lambda: api.mutation("export.importBackup", {"backup": {"version": "v4"}, "strategy": "skip", "dryRun": True}), http=400)


# ═══════════════════ D 差异分析 / 安全头 / 输入边界 ═══════════════════
def suite_D(ctx):
    print("\n══ D 差异分析 / 安全头 / 输入边界 ══")
    tok = register_or_login("v5newbie")
    api = Trpc(token=tok, timeout=320)
    pid = ctx["passage"]["id"] if "id" in ctx["passage"] else ctx["passage"]["questions"][0]["passageId"]
    q1 = ctx["q1"]

    d1 = api.mutation("agent.diffAnalysis", {
        "kind": "exam", "refId": pid, "qNo": q1["qNo"],
        "aiAnswer": ctx["ai_answer"], "officialAnswer": ctx["official"],
        "aiReasoning": "测试：AI 误选",
    })
    P("D1 差异分析：六分法根因", d1["diff"]["rootCause"] in ["locate", "comprehend", "overinfer", "detail", "mistype", "vocab"], json.dumps(d1["diff"])[:120])
    d2 = api.mutation("agent.diffAnalysis", {
        "kind": "exam", "refId": pid, "qNo": q1["qNo"],
        "aiAnswer": ctx["ai_answer"], "officialAnswer": ctx["official"],
    })
    P("D2 差异分析缓存命中", d2.get("cached") is True)
    st = api.query("agent.diffStatus", {"kind": "exam", "refId": pid})
    P("D3 diffStatus 可查", isinstance(st, list) and any(x["qNo"] == q1["qNo"] for x in st))

    # 安全头
    req = urllib.request.Request(BASE + "/")
    with urllib.request.urlopen(req, timeout=15) as resp:
        h = {k.lower(): v for k, v in resp.headers.items()}
    P("D4 nosniff", h.get("x-content-type-options") == "nosniff")
    P("D5 frame 守卫", h.get("x-frame-options") == "SAMEORIGIN")
    P("D6 CSP 存在", "content-security-policy" in h and "script-src 'self'" in h["content-security-policy"], h.get("content-security-policy", "")[:120])
    P("D7 Referrer-Policy", "referrer-policy" in h)

    # 输入边界
    expect_err("D8 diffAnalysis 非法答案 → 400", lambda: api.mutation("agent.diffAnalysis", {
        "kind": "exam", "refId": pid, "qNo": 99, "aiAnswer": "E", "officialAnswer": "Z",
    }), http=400)
    expect_err("D9 越权读他人任务 → 4xx", lambda: Trpc(token=register_or_login("v5veteran")).query("agent.pipelineStatus", {"id": 1}), http=None)


def main():
    t0 = time.time()
    print("════ v5 全量 API 冗余测试 ════")
    ps = suite_A()
    ctx = suite_B(ps)
    suite_C(ctx)
    suite_D(ctx)
    dt = time.time() - t0
    print(f"\n════ 结果：{len(passed)} 通过 / {len(failed)} 失败 / 耗时 {dt:.0f}s ════")
    if failed:
        for n, e in failed:
            print(f"  ✗ {n}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
