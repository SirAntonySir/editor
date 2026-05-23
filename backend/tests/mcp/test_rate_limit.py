import time

from app.mcp.rate_limit import RateLimiter


def test_under_limit_passes() -> None:
    rl = RateLimiter(rate_per_minute=30)
    for _ in range(5):
        assert rl.try_consume("s1") is True


def test_over_limit_blocks() -> None:
    rl = RateLimiter(rate_per_minute=2, capacity=2)
    assert rl.try_consume("s1") is True
    assert rl.try_consume("s1") is True
    assert rl.try_consume("s1") is False


def test_isolated_per_session() -> None:
    rl = RateLimiter(rate_per_minute=1, capacity=1)
    assert rl.try_consume("s1") is True
    assert rl.try_consume("s2") is True
    assert rl.try_consume("s1") is False


def test_refill_after_time() -> None:
    rl = RateLimiter(rate_per_minute=60, capacity=1)  # 1 per second
    assert rl.try_consume("s1") is True
    assert rl.try_consume("s1") is False
    time.sleep(1.1)
    assert rl.try_consume("s1") is True
