#!/usr/bin/env python3
"""v5 流水线端到端：startPipeline(带答案) → 轮询至 done →
断言 payload 五段齐全 / verdicts 以官方答案为基准 / officialAnswers 落载 /
solved 含 reflection / methodRefs 全合法 / saveResult 落库闭环。

用法：python3 test_pipeline_v5.py [year textNo]   默认 2011 2
"""
from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from trpc_call import Trpc  # noqa: E402

BASE = os.environ.get("BASE", "http://localhost:3000")
PASSWORD = "Test#2026v5"


def main():
    year, text_no = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (2011, 2)
    anon = Trpc()
    try:
        tok = anon.mutation("auth.register", {
            "name": "v5pipe", "password": PASSWORD,
            "recoveryQuestion": "本测试套件的代号是什么", "recoveryAnswer": "v5",
        })["token"]
    except Exception:
        tok = anon.mutation("auth.login", {"name": "v5pipe", "password": PASSWORD})["token"]
    api = Trpc(token=tok, timeout=600)

    rows = anon.query("passage.list")
    p = next(r for r in rows if r["year"] == year and r["textNo"] == text_no)
    pid = p["id"]
    det = anon.query("passage.detail", {"id": pid})
    key_map = {q["qNo"]: q["answer"] for q in det["questions"]}
    print(f"══ {year} Text{text_no} (id={pid}) 官方答案 {key_map} ══")

    # 用户作答：第 1 题故意选错，其余选官方答案
    answers = {}
    for q in det["questions"]:
        official = q["answer"]
        answers[str(q["id"])] = official if q["qNo"] != 1 else next(c for c in "ABCD" if c != official)

    t0 = time.time()
    job = api.mutation("agent.startPipeline", {"kind": "exam", "refId": pid, "answers": answers})
    jid = job["jobId"]
    print(f"任务 {jid} 已启动（reused={job.get('reused')}）")

    # 轮询：任务总死线 12 分钟，客户端给到 13 分钟上限
    last_stage = ""
    while time.time() - t0 < 780:
        st = api.query("agent.pipelineStatus", {"id": jid})
        stages = st.get("stages", [])
        running = next((s["stage"] for s in stages if s["status"] == "running"), "")
        if running != last_stage:
            print(f"  …{int(time.time() - t0)}s 阶段 {running or '排队中'}")
            last_stage = running
        if st["status"] in ("done", "error"):
            break
        time.sleep(5)
    dt = time.time() - t0
    print(f"状态={st['status']} 总耗时 {dt:.0f}s")
    if st["status"] != "done":
        print("✗ 流水线未完成:", json.dumps(st.get("stages", []), ensure_ascii=False)[:400])
        sys.exit(1)

    payload = st["payload"]
    ok = True

    def chk(name, cond, extra=""):
        nonlocal ok
        print(("  ✓ " if cond else "  ✗ ") + name + ("" if cond else f"  {extra}"))
        ok = ok and cond

    # 五段齐全
    chk("五段齐全", all(k in payload for k in ["structure", "qAnalysis", "locate", "solved", "review"]),
        str([k for k in ["structure", "qAnalysis", "locate", "solved", "review"] if k not in payload]))
    solved = payload.get("solved", [])
    chk("解题 5 题", len(solved) == len(det["questions"]), f"got {len(solved)}")

    # 判分基准：verdicts 以官方答案为准（第 1 题应判错，其余判对——除非 AI 答案与官方分歧）
    verdicts = payload.get("verdicts", {})
    oa = {i["qNo"]: i for i in payload.get("officialAnswers", [])}
    chk("officialAnswers 落载", len(oa) == len(det["questions"]), json.dumps(payload.get("officialAnswers"))[:200])
    for q in det["questions"]:
        k = str(q["id"])
        mine = answers[k]
        official = q["answer"]
        ai = next((s["answer"] for s in solved if s["qNo"] == q["qNo"]), None)
        expected = mine == official
        got = verdicts.get(k)
        chk(f"Q{q['qNo']} verdict={got}（我选{mine} 官方{official} AI{ai}）", got is expected, f"expected {expected}")

    # reflection 字段（v5 新增；允许个别缺省但不允许全缺）
    refl = sum(1 for s in solved if s.get("reflection"))
    chk("reflection 复盘字段（≥3/5 题）", refl >= 3, f"only {refl}")

    # methodRefs 全合法
    clauses = anon.query("method.clauses")
    valid = {c["clauseId"] for c in clauses}
    total, bad = 0, []
    for s in solved:
        for r in s.get("methodRefs") or []:
            total += 1
            if r.get("clauseId") not in valid:
                bad.append((s["qNo"], r.get("clauseId")))
    chk(f"methodRefs 合法（{total} 条）", not bad, str(bad))

    # saveResult 闭环：复用流水线 payload 落库
    sr = api.mutation("agent.saveResult", {
        "kind": "exam", "passageId": pid, "payload": payload, "modelUsed": "pipeline-v5-test",
        "answers": answers, "verdicts": verdicts,
        "solvedItems": [{"qNo": s["qNo"], "answer": s["answer"], "qType": s.get("qType", "")} for s in solved],
        "durationSec": int(dt), "skipAnalysis": True,
    })
    chk("saveResult 落库", isinstance(sr, dict))
    wl = api.query("wrong.list", {})
    q1 = det["questions"][0]
    w = next((x for x in wl if x["refId"] == pid and x["qNo"] == q1["qNo"]), None)
    chk("故意错选的第 1 题入错题本", w is not None and w["myAnswer"] == answers[str(q1["id"])],
        json.dumps(w, ensure_ascii=False)[:150] if w else "None")
    chk("入册正确答案=官方", w is not None and w["correctAnswer"] == q1["answer"],
        f"{w and w['correctAnswer']} vs {q1['answer']}")
    hist = api.query("agent.history")
    chk("历史档案含本次记录", any(h.get("refId", h.get("passageId")) == pid for h in (hist if isinstance(hist, list) else hist.get("items", []))),
        json.dumps(hist, ensure_ascii=False)[:150])

    print("══ 流水线端到端:", "全过 ✅" if ok else "有失败 ❌", "══")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
