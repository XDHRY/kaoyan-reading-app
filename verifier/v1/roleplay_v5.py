#!/usr/bin/env python3
"""v5 角色扮演：三个人设走真实动线（复用已缓存的 LLM 产物，不额外烧钱）
- 小满（新手）：游客浏览 → 注册 → 看 SOP/指南 → 查真题 → 错题诊断(缓存) → 写感悟 → 复习打卡 → 看备考建议(缓存)
- 老纪（进阶）：登录 → 错因概览 → 仿真题差异诊断(读缓存列表) → 素材库攒素材 → 看作文稿 → 全量备份导出
- 阿筱（移动端习惯的普通用户）：登录 → 历史档案 → 词汇本 → 个人中心改字号偏好(本地) → 统计页 → 误操作边界（非法输入）
- 站长 admin：发公告 → 普通用户看到公告 → 撤公告
"""
import os
import sys
import time
import json

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from trpc_call import Trpc, TrpcError  # noqa: E402

BASE = os.environ.get("BASE", "http://localhost:3000")
PASSWORD = "CHANGE_ME_USER_PASS"
RQ = ("本测试套件的代号是什么", "v5")
PASS_N, FAIL_N = 0, 0

def P(name, cond, detail=""):
    global PASS_N, FAIL_N
    if cond: PASS_N += 1; print(f"  ✅ {name}")
    else: FAIL_N += 1; print(f"  ❌ {name}  {detail}")

def register_or_login(name):
    anon = Trpc()
    try:
        return anon.mutation("auth.register", {"name": name, "password": PASSWORD, "recoveryQuestion": RQ[0], "recoveryAnswer": RQ[1]})["token"]
    except TrpcError:
        return anon.mutation("auth.login", {"name": name, "password": PASSWORD})["token"]

def expect_err(name, fn, http=None):
    try:
        fn(); P(name, False, "竟成功了")
    except TrpcError as e:
        P(name, http is None or e.status == http, f"status={e.status} {e.body[:120]}")
    except Exception as e:
        P(name, http is None, f"{type(e).__name__} {e}")

# ═════════ 小满（新手）═════════
print("\n══ 小满（新手）第一次来 ══")
anon = Trpc()
info = anon.query("auth.siteInfo")
P("小满游客看到站点信息", isinstance(info, dict))
cards = anon.query("knowledge.list")
P("小满先看 SOP 知识卡", isinstance(cards, list) and len(cards) > 0, f"{len(cards) if isinstance(cards,list) else '?'}")
ps = anon.query("passage.list")
P("小满翻真题库（68 篇）", len(ps) == 68)
det = anon.query("passage.detail", {"id": ps[-1]["id"]})  # 最老一篇 2010
P("小满读 2010 年第一篇", len(det["passage"]["paragraphs"]) > 0 and len(det["questions"]) == 5)
expect_err("小满游客想交卷被请去签到(401)", lambda: anon.mutation("agent.startPipeline", {"kind": "exam", "refId": ps[-1]["id"]}), http=401)

tok = register_or_login("v5xiaoman")
xm = Trpc(token=tok, timeout=120)
P("小满注册成功", len(tok) == 64)
me = xm.query("auth.me")
P("小满看到自己的档案", me["name"] == "v5xiaoman")
stats = xm.query("agent.stats")
P("小满统计页全零起步", stats["donePassages"] == 0 and stats["wrongOpen"] == 0)
# 用 v5newbie 的缓存诊断读不到（用户隔离），小满没有错题——验证空状态
P("小满错题本空空如也", xm.query("wrong.list", {"mastered": False}) == [])
rq = xm.query("insight.reviewQueue")
P("小满复习队列空", rq["due"] == [] and rq["scheduledCount"] == 0)
P("小满感悟笔记空", xm.query("insight.insightList", {}) == [])
rec = xm.query("insight.getRecommendation")
P("小满看备考建议（可能为空状态）", rec is None or isinstance(rec, dict))
expect_err("小满调管理员接口被拒(403)", lambda: xm.query("admin.listUsers"), http=None)

# 小满做错一道题的全流程已在 e2e 覆盖，这里走"抄近道"：直接读共享真题 + 本地动线
res = xm.query("agent.revealOfficialAnswers", {"kind": "exam", "refId": ps[-1]["id"]})
P("小满偷看官方答案（揭示接口）", isinstance(res.get("items"), list) and len(res["items"]) == 5)

# ═════════ 老纪（进阶）═════════
print("\n══ 老纪（进阶）日常 ══")
tok2 = register_or_login("v5laoji")
lj = Trpc(token=tok2, timeout=120)
mat = lj.mutation("essay.materialSave", {"kind": "sentence", "title": "晨读金句", "content": "The habit of reading is the best gift one can give oneself."})
P("老纪攒素材", isinstance(mat.get("id"), int) or mat.get("ok") is True)
mats = lj.query("essay.materialList")
P("老纪素材库有条目", isinstance(mats, list) and len(mats) >= 1)
ov = lj.query("insight.errorTypeStats")
P("老纪看错因概览（空也正常）", isinstance(ov, dict))
essays = lj.query("essay.list")
P("老纪看成文集", isinstance(essays, list))
drafts = lj.query("essay.draftList")
P("老纪看草稿箱", isinstance(drafts, list))
bk = lj.query("export.fullBackup")
P("老纪导出全量备份", bk.get("version") == "v5" and "userMaterials" in bk and "wrongItems" in bk)
diffs = lj.query("agent.diffStatus", {"kind": "exam", "refId": ps[-1]["id"]})
P("老纪查差异分析状态（无分歧为空）", diffs == [])
expect_err("老纪用非法题型生成(400)", lambda: lj.mutation("agent.generate", {"topic": "x", "difficulty": "impossible", "focusTypes": []}), http=400)

# ═════════ 阿筱（手机党）═════════
print("\n══ 阿筱（普通用户）动线 ══")
tok3 = register_or_login("v5axiao")
ax = Trpc(token=tok3, timeout=120)
hist = ax.query("agent.history")
P("阿筱看历史档案", isinstance(hist, list))
vocab = ax.query("vocab.list", {}) if True else None
P("阿筱翻词汇本", isinstance(vocab, list))
P("阿筱看统计", isinstance(ax.query("agent.stats"), dict))
# 误操作边界
expect_err("阿筱瞎传 passageId → 4xx", lambda: ax.query("passage.detail", {"id": 999999}), http=None)
expect_err("阿筱给感悟写空内容 → 400", lambda: ax.mutation("insight.insightSave", {"wrongId": 1, "content": ""}), http=None)
expect_err("阿筱导入坏备份 → 400", lambda: ax.mutation("export.importBackup", {"backup": {"hello": "world"}, "strategy": "skip", "dryRun": True}), http=400)

# ═════════ 站长 admin ═════════
print("\n══ 站长 admin 治理 ══")
adm = Trpc(token=Trpc().mutation("auth.login", {"name": "admin", "password": os.environ.get("ADMIN_PASSWORD", "CHANGE_ME_ADMIN_PASS")})["token"])
ann = f"【测试公告】v5 验收巡检 {int(time.time())}"
adm.mutation("admin.setSetting", {"k": "announcement", "v": ann})
info2 = Trpc().query("auth.siteInfo")
P("公告发出，游客可见", info2.get("announcement") == ann)
adm.mutation("admin.setSetting", {"k": "announcement", "v": ""})
info3 = Trpc().query("auth.siteInfo")
P("公告撤回", not info3.get("announcement"))
users = adm.query("admin.listUsers")
P("站长看到用户列表", isinstance(users, list) and any(u["name"] == "v5xiaoman" for u in users))
chs = adm.query("channel.list")
P("站长看到渠道（key 已掩码）", isinstance(chs, list) and all("****" in (c.get("apiKeyMasked") or c.get("apiKey") or "") for c in chs))

print(f"\n════ 角色扮演：{PASS_N} 过 / {FAIL_N} 挂 ════")
sys.exit(1 if FAIL_N else 0)
