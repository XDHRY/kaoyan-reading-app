import { Link } from "react-router";
import { Seal } from "@/components/ink/Seal";

export default function NotFound() {
  return (
    <div className="text-center py-24">
      <Seal size={96} seed="404" text="迷途知返" center="返" />
      <h1 className="text-[32px] font-black mt-6">此页不存在</h1>
      <p className="text-[var(--ink-3)] mt-2 mb-6">书页翻错了地方，回到正卷继续。</p>
      <Link to="/" className="px-5 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow">
        回仪表盘
      </Link>
    </div>
  );
}
