#!/usr/bin/env python3
"""内容质量审查：跑真实流水线，逐阶段按教学标准打分（不是链路测试，是阅卷）
用法: python3 quality_review.py [--kind exam --ref 1]
"""
import json, urllib.request, urllib.parse, time, sys

BASE = "http://localhost:3000/api/trpc"

def call(path, payload=None, token=None, method=None, timeout=60):
    url = f"{BASE}/{path}"
    h = {"Content-Type": "application/json"}
    if token: h["x-session-token"] = token
    if payload is None and method != "POST":
        url += "?input=" + urllib.parse.quote(json.dumps({"json": None})); req = urllib.request.Request(url, headers=h)
    elif method == "GET":
        url += "?input=" + urllib.parse.quote(json.dumps({"json": payload})); req = urllib.request.Request(url, headers=h)
    else:
        req = urllib.request.Request(url, data=json.dumps({"json": payload}).encode(), headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        b = json.loads(r.read())
        if "error" in b: raise RuntimeError(str((b["error"].get("json") or {}).get("message"))[:300])
        return b["result"]["data"]["json"]

SCORES = []
def score(stage, item, cond, note=""):
    SCORES.append((stage, item, bool(cond), note))

def review_structure(st, para_count):
    S = "结构"
    score(S, "篇章模式具体", st.get("pattern") and len(str(st["pattern"])) > 8, str(st.get("pattern"))[:60])
    score(S, "主旨含态度倾向", st.get("gist") and len(str(st["gist"])) >= 20, str(st.get("gist"))[:60])
    paras = st.get("paragraphs") or []
    if para_count:
        score(S, f"覆盖全部段落({len(paras)}/{para_count})", len(paras) == para_count)
    else:
        score(S, "段落分析≥5段", len(paras) >= 5, f"{len(paras)}段")
    score(S, "每段有主旨句原文", all(p.get("keySentence") for p in paras))
    score(S, "每段主旨句有翻译", all(p.get("keySentenceZh") for p in paras))
    score(S, "每段有段间逻辑(首段外)", all(p.get("logic") for p in paras[1:]) if len(paras) > 1 else False)
    score(S, "论证推进路线≥150字", len(str(st.get("logicFlow", ""))) >= 150, f'{len(str(st.get("logicFlow","")))}字')
    score(S, "有考场读法提示", bool(st.get("readingTips")), str(st.get("readingTips",""))[:40])

def review_questions(items):
    S = "审题"
    score(S, "五题齐全", len(items) == 5)
    for q in items:
        n = q.get("qNo")
        score(S, f"q{n} 题型+标志词", q.get("qType") and q.get("marker"), q.get("marker",""))
        score(S, f"q{n} 判定思路≥60字", len(str(q.get("reasoning",""))) >= 60, f'{len(str(q.get("reasoning","")))}字')
        score(S, f"q{n} 有解题范围指导", bool(q.get("scopeGuide")))
        score(S, f"q{n} 有避坑提醒", bool(q.get("pitfall")), str(q.get("pitfall",""))[:30])

def review_locate(items):
    S = "定位"
    score(S, "五题齐全", len(items) == 5)
    for q in items:
        n = q.get("qNo")
        score(S, f"q{n} 定位句非空且完整", q.get("sentence") and len(str(q["sentence"])) > 30)
        score(S, f"q{n} 定位句有翻译", bool(q.get("sentenceZh")))
        score(S, f"q{n} 有改写对照", bool(q.get("rewriteForm")))
        score(S, f"q{n} 定位思路≥40字", len(str(q.get("howFound",""))) >= 40, f'{len(str(q.get("howFound","")))}字')

def review_solve(items):
    S = "解题"
    score(S, "五题齐全", len(items) == 5)
    for q in items:
        n = q.get("qNo")
        score(S, f"q{n} 有证据句+翻译", q.get("evidence") and q.get("evidenceZh"))
        score(S, f"q{n} 有证据映射", bool(q.get("evidenceMap")), str(q.get("evidenceMap",""))[:30])
        opts = q.get("options") or []
        score(S, f"q{n} 四项全分析", len(opts) == 4)
        score(S, f"q{n} 逐项≥50字", all(len(str(o.get("analysis",""))) >= 50 for o in opts),
              "/".join(str(len(str(o.get("analysis","")))) for o in opts))
        score(S, f"q{n} 错误项有陷阱手法", all(o.get("trap") for o in opts if o.get("verdict") == "错"))
        score(S, f"q{n} 完整思路≥120字", len(str(q.get("reasoning",""))) >= 120, f'{len(str(q.get("reasoning","")))}字')
        score(S, f"q{n} 有解题口诀", bool(q.get("takeaway")), str(q.get("takeaway",""))[:30])
        score(S, f"q{n} 方法引用≥1条", len(q.get("methodRefs") or []) >= 1)

def main():
    kind = "exam"; ref = 1
    args = sys.argv[1:]
    if "--kind" in args: kind = args[args.index("--kind")+1]
    if "--ref" in args: ref = int(args[args.index("--ref")+1])

    r = call("auth.login", {"name": "admin", "password": "CHANGE_ME_ADMIN_PASS"}, method="POST")
    AT = r["token"]

    # 查段落数（供结构覆盖检查）
    if kind == "exam":
        try:
            ps = call("passage.detail", {"id": ref}, method="GET")
            para_count = len(ps.get("passage", {}).get("paragraphs", [])) if ps else 0
        except Exception:
            para_count = 0
    else:
        para_count = 0  # 生成题按产物自查

    # 强制全新跑一次（删掉该内容旧任务）
    r = call("agent.startPipeline", {"kind": kind, "refId": ref, "answers": {}}, token=AT, method="POST")
    job_id = r["jobId"] if not r.get("existing") else r["jobId"]
    if r.get("existing"):
        r2 = call("agent.retryPipeline", {"id": job_id}, token=AT, method="POST")
    print(f"任务 {job_id} 启动，等待完成……")
    job = None
    for _ in range(160):
        time.sleep(5)
        job = call("agent.pipelineStatus", {"id": job_id}, token=AT, method="GET")
        if job["status"] != "running": break
    print(f"状态: {job['status']}", f"错误: {job.get('errorMsg','')[:200]}" if job["status"]=="error" else "")
    if job["status"] != "done":
        print(json.dumps(job.get("stages"), ensure_ascii=False, indent=1)[:1500]); sys.exit(1)

    p = job["payload"]
    if kind == "generated":
        para_count = len((p.get("structure") or {}).get("paragraphs") or [])
    review_structure(p.get("structure") or {}, para_count)
    review_questions(p.get("qAnalysis") or [])
    review_locate(p.get("locate") or [])
    review_solve(p.get("solved") or [])

    cc = p.get("crosscheck") or {}
    if not cc.get("skipped"):
        score("交叉", "第二模型参与", bool(cc.get("items")), cc.get("model",""))

    passed = sum(1 for s in SCORES if s[2])
    total = len(SCORES)
    print(f"\n━━━━ 质量审查 {passed}/{total} ━━━━")
    cur = None
    for stage, item, ok, note in SCORES:
        if stage != cur: print(f"\n【{stage}】"); cur = stage
        mark = "✅" if ok else "❌"
        print(f" {mark} {item}" + (f" — {note}" if note and not ok else ""))
    print(f"\n总评：{passed}/{total}" + ("  全部达标 🎉" if passed == total else ""))
    # 导出完整产物供人工品读
    import os
    out = os.path.join(os.environ.get("TEMP", "."), f"quality_{kind}_{ref}.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(p, f, ensure_ascii=False, indent=1)
    print(f"完整产物已存 {out}")

main()
