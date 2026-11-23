"""位置计算服务（分数索引）。

规则见 PROJECT_PLAN 4.3：
- position 使用 DECIMAL(38,18)
- 每次移动只写一张卡，取前后邻居中值
- 间隙耗尽（nxt - prev < EPSILON）时在事务内按当前顺序整列重排为 1024 的倍数
"""

from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal

DEFAULT_GAP = Decimal(1024)
EPSILON = Decimal("1e-9")


def position_between(prev: Decimal | None, nxt: Decimal | None) -> Decimal:
    """计算落在 prev 与 nxt 之间的新位置。"""
    if prev is None and nxt is None:
        return DEFAULT_GAP
    if prev is None:
        assert nxt is not None
        return nxt / 2
    if nxt is None:
        return prev + DEFAULT_GAP
    return (prev + nxt) / 2


def gap_exhausted(prev: Decimal | None, nxt: Decimal | None) -> bool:
    """判断两邻居间隙是否已耗尽，需要整列重排。"""
    if prev is None or nxt is None:
        return False
    return (nxt - prev) < EPSILON


def rebalance_positions(count: int) -> list[Decimal]:
    """按当前顺序生成 1024, 2048, ... 的新位置序列。"""
    return [DEFAULT_GAP * (i + 1) for i in range(count)]


def first_position(existing: Sequence[Decimal]) -> Decimal:
    """新列表/卡片追加到末尾时的位置。"""
    if not existing:
        return DEFAULT_GAP
    return max(existing) + DEFAULT_GAP
