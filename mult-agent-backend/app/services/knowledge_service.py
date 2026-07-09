import json
import re
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from app.models.task import KnowledgeEntry, TaskResult

logger = logging.getLogger(__name__)

STOP_WORDS = {
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
    "没有", "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些",
    "什么", "怎么", "如何", "为什么", "可以", "这个", "那个", "还", "被",
    "把", "让", "用", "从", "对", "与", "但", "或", "且", "the", "a", "an",
    "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "may", "might",
    "can", "shall", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "between", "under", "again", "further", "then", "once", "here", "there",
    "when", "where", "why", "how", "all", "both", "each", "few", "more",
    "most", "other", "some", "such", "no", "nor", "not", "only", "own",
    "same", "so", "than", "too", "very", "just", "because", "about", "up",
    "out", "if", "now", "its", "it", "and", "but", "or", "yet",
}

CATEGORY_RULES = [
    (["安全", "漏洞", "渗透", "攻击", "防御", "加密", "认证", "授权", "审计", "security", "exploit", "xss", "sql注入", "csrf"], "安全测试"),
    (["产品", "需求", "PRD", "用户故事", "原型", "UX", "体验", "功能", "市场", "竞品", "产品经理"], "产品设计"),
    (["代码", "编程", "开发", "实现", "函数", "类", "接口", "API", "code", "programming", "算法", "数据结构", "重构"], "代码开发"),
    (["测试", "test", "用例", "单元测试", "集成测试", "E2E", "覆盖率", "QA", "质量", "调试", "debug", "bug"], "测试质量"),
    (["部署", "deploy", "CI/CD", "Docker", "K8s", "容器", "运维", "监控", "日志", "告警", "基础设施", "服务器"], "部署运维"),
    (["数据库", "SQL", "NoSQL", "MySQL", "PostgreSQL", "MongoDB", "缓存", "Redis", "数据", "存储", "查询"], "数据存储"),
    (["前端", "frontend", "UI", "React", "Vue", "CSS", "HTML", "JavaScript", "TypeScript", "组件", "页面", "交互"], "前端开发"),
    (["后端", "backend", "服务", "API", "FastAPI", "Flask", "Django", "中间件", "路由", "服务端"], "后端开发"),
    (["AI", "ML", "模型", "训练", "推理", "LLM", "GPT", "Claude", "Agent", "智能", "神经网络", "深度学习", "NLP"], "AI/ML"),
]


def _extract_keywords(text: str, max_kw: int = 8) -> list[str]:
    tokens = re.findall(r"[一-鿿]{2,}|[a-zA-Z]{3,}", text.lower())
    freq: dict[str, int] = {}
    for t in tokens:
        t = t.strip().lower()
        if t in STOP_WORDS or len(t) < 2:
            continue
        freq[t] = freq.get(t, 0) + 1
    sorted_kw = sorted(freq.items(), key=lambda x: x[1], reverse=True)
    return [kw for kw, _ in sorted_kw[:max_kw]]


def _classify(keywords: list[str], description: str) -> str:
    combined = " ".join(keywords) + " " + description.lower()
    for kw_list, category in CATEGORY_RULES:
        for kw in kw_list:
            if kw.lower() in combined:
                return category
    return "通用"


async def add_feedback(
    db: AsyncSession,
    task_id: str,
    agent_name: str,
    output: str,
    summary: str,
    question: str,
    feedback: str,
):
    """用户对 Agent 回复的反馈：positive=点赞保存为经验，negative=踩保存为教训，空字符串=删除反馈。"""

    # 已有条目的查询
    existing = await db.execute(
        select(KnowledgeEntry).where(
            KnowledgeEntry.task_id == task_id,
            KnowledgeEntry.agent_name == agent_name,
        )
    )
    entry = existing.scalar_one_or_none()

    # 取消反馈 → 删除条目
    if not feedback:
        if entry:
            await db.delete(entry)
            await db.commit()
        return None

    text = summary + " " + output
    keywords = _extract_keywords(text)
    category = _classify(keywords, text)

    if entry:
        entry.feedback = feedback
        entry.question = question
        entry.keywords = json.dumps(keywords, ensure_ascii=False)
        entry.category = category
    else:
        entry = KnowledgeEntry(
            task_id=task_id,
            agent_name=agent_name,
            content=output,
            summary=summary,
            feedback=feedback,
            question=question,
            keywords=json.dumps(keywords, ensure_ascii=False),
            category=category,
        )
        db.add(entry)

    await db.commit()
    return entry


async def search_knowledge(db: AsyncSession, query: str, limit: int = 3) -> list[dict]:
    query_kw = _extract_keywords(query, max_kw=5)
    if not query_kw:
        return []

    stmt = select(KnowledgeEntry).where(KnowledgeEntry.feedback != "").order_by(KnowledgeEntry.id.desc()).limit(200)
    result = await db.execute(stmt)
    all_entries = list(result.scalars().all())

    scored = []
    for entry in all_entries:
        score = 0
        entry_text = (entry.question + " " + entry.summary + " " + entry.content).lower()
        try:
            entry_kw = json.loads(entry.keywords) if isinstance(entry.keywords, str) else entry.keywords
        except (json.JSONDecodeError, TypeError):
            entry_kw = []

        for kw in query_kw:
            if kw.lower() in entry_text:
                score += 2
            if kw.lower() in " ".join(entry_kw).lower():
                score += 3

        if entry.category:
            cat_kw = _extract_keywords(entry.category)
            for ck in cat_kw:
                if ck.lower() in query.lower():
                    score += 1

        # positive feedback boost
        if entry.feedback == "positive":
            score += 2

        if score > 0:
            scored.append((score, entry))

    scored.sort(key=lambda x: x[0], reverse=True)

    return [
        {
            "id": e.id,
            "task_id": e.task_id,
            "agent_name": e.agent_name,
            "summary": e.summary,
            "question": e.question,
            "feedback": e.feedback,
            "category": e.category,
            "keywords": json.loads(e.keywords) if isinstance(e.keywords, str) else e.keywords,
            "relevance": s,
        }
        for s, e in scored[:limit]
    ]


async def build_knowledge_context(db: AsyncSession, query: str, limit: int = 3) -> str:
    """构建经验上下文，正面经验 + 负面教训分别展示。"""
    entries = await search_knowledge(db, query, limit)
    if not entries:
        return ""

    positives = [e for e in entries if e["feedback"] == "positive"]
    negatives = [e for e in entries if e["feedback"] == "negative"]

    lines = []

    if positives:
        lines.append("## 历史经验（点赞过的做法）")
        for i, e in enumerate(positives, 1):
            q = e["question"][:100] or e["summary"][:100]
            lines.append(f"{i}. 问题: {q}\n   答案: {e['summary'][:150]}")

    if negatives:
        lines.append("\n## 历史教训（踩过的坑，请避免）")
        for i, e in enumerate(negatives, 1):
            q = e["question"][:100] or e["summary"][:100]
            lines.append(f"{i}. 问题: {q}\n   失败原因: {e['summary'][:150]}")

    return "\n".join(lines)


async def get_knowledge_count(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count()).select_from(KnowledgeEntry).where(KnowledgeEntry.feedback != "")
    )
    return result.scalar() or 0


async def get_all_knowledge(db: AsyncSession, limit: int = 50) -> list[dict]:
    stmt = select(KnowledgeEntry).where(KnowledgeEntry.feedback != "").order_by(KnowledgeEntry.id.desc()).limit(limit)
    result = await db.execute(stmt)
    entries = list(result.scalars().all())
    return [
        {
            "id": e.id,
            "task_id": e.task_id,
            "agent_name": e.agent_name,
            "summary": e.summary,
            "question": e.question,
            "feedback": e.feedback,
            "category": e.category,
            "keywords": json.loads(e.keywords) if isinstance(e.keywords, str) else e.keywords,
        }
        for e in entries
    ]


async def delete_knowledge(db: AsyncSession, knowledge_id: int) -> bool:
    result = await db.execute(delete(KnowledgeEntry).where(KnowledgeEntry.id == knowledge_id))
    await db.commit()
    return result.rowcount > 0
