-- 0005 公告简介：首页横幅与公告榜摘要位（TiDB：TEXT 不可带默认值，故可空）
ALTER TABLE announcements ADD COLUMN digest TEXT NULL;
