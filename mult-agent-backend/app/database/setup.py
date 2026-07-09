from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text
from app.config import DATABASE_URL
from app.models.task import Base

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # 轻量迁移：为已存在的 tasks 表补齐 workspace_dir 列
        try:
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN workspace_dir VARCHAR DEFAULT ''"))
        except Exception:
            pass  # 列已存在

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
