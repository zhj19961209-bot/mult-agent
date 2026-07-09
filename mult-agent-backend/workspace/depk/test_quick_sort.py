"""
test_quick_sort.py — 快速排序测试用例

覆盖 PRD 中的所有验收标准。
"""

from quick_sort import quick_sort, quick_sort_inplace


def test_empty_list():
    """FR-2: 空列表返回空列表"""
    assert quick_sort([]) == []
    print("✅ 测试通过: 空列表")


def test_single_element():
    """FR-3: 单元素列表"""
    assert quick_sort([5]) == [5]
    print("✅ 测试通过: 单元素列表")


def test_normal_sort():
    """FR-1: 正常整数列表升序排序"""
    assert quick_sort([3, 6, 8, 10, 1, 2, 1]) == [1, 1, 2, 3, 6, 8, 10]
    print("✅ 测试通过: 正常排序")


def test_duplicates():
    """FR-4: 包含重复元素"""
    assert quick_sort([4, 2, 4, 2, 4]) == [2, 2, 4, 4, 4]
    print("✅ 测试通过: 重复元素")


def test_negative_numbers():
    """FR-6: 负数排序"""
    assert quick_sort([-3, -1, -2, 0]) == [-3, -2, -1, 0]
    print("✅ 测试通过: 负数排序")


def test_already_sorted():
    """已排序列表"""
    assert quick_sort([1, 2, 3, 4, 5]) == [1, 2, 3, 4, 5]
    print("✅ 测试通过: 已排序列表")


def test_reverse_sorted():
    """逆序列表"""
    assert quick_sort([5, 4, 3, 2, 1]) == [1, 2, 3, 4, 5]
    print("✅ 测试通过: 逆序列表")


def test_inplace_sort():
    """FR-5: 原地排序版本"""
    arr = [3, 6, 8, 10, 1, 2, 1]
    quick_sort_inplace(arr)
    assert arr == [1, 1, 2, 3, 6, 8, 10]
    print("✅ 测试通过: 原地排序")


if __name__ == "__main__":
    test_empty_list()
    test_single_element()
    test_normal_sort()
    test_duplicates()
    test_negative_numbers()
    test_already_sorted()
    test_reverse_sorted()
    test_inplace_sort()
    print("\n🎉 全部测试通过！")
