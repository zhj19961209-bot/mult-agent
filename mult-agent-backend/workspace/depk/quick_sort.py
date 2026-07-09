"""
quick_sort.py — 快速排序实现

Author: 张海杰
Language: Python
描述: 基于 PRD 需求实现的快速排序，支持整数列表升序排序。
"""

from typing import List


def quick_sort(arr: List[int]) -> List[int]:
    """
    快速排序（返回新列表，非原地排序）

    参数:
        arr: 待排序整数列表

    返回:
        升序排列后的新列表
    """
    # FR-2: 空列表直接返回
    if len(arr) <= 1:
        return arr[:]

    # 选择基准元素（取中间元素，避免最坏情况）
    pivot = arr[len(arr) // 2]

    # 分区
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]

    # 递归排序并合并
    return quick_sort(left) + middle + quick_sort(right)


def quick_sort_inplace(arr: List[int], low: int = 0, high: int = None) -> None:
    """
    快速排序（原地排序，in-place）

    参数:
        arr: 待排序列表（会被直接修改）
        low: 起始索引
        high: 结束索引
    """
    if high is None:
        high = len(arr) - 1

    if low < high:
        pi = _partition(arr, low, high)
        quick_sort_inplace(arr, low, pi - 1)
        quick_sort_inplace(arr, pi + 1, high)


def _partition(arr: List[int], low: int, high: int) -> int:
    """分区函数，返回基准元素的最终位置"""
    pivot = arr[high]  # 选最后一个元素为基准
    i = low - 1

    for j in range(low, high):
        if arr[j] <= pivot:
            i += 1
            arr[i], arr[j] = arr[j], arr[i]

    arr[i + 1], arr[high] = arr[high], arr[i + 1]
    return i + 1
