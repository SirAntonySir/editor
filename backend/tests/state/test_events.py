import asyncio

import pytest

from app.schemas.widget import StateEvent
from app.state.events import EventBus


def _event(kind: str = "widget.created", rev: int = 1) -> StateEvent:
    return StateEvent(revision=rev, kind=kind, payload={"ping": True})  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_publish_to_subscriber_delivers_event() -> None:
    bus = EventBus()
    queue = bus.subscribe("s1")
    bus.publish("s1", _event())
    received = await asyncio.wait_for(queue.get(), timeout=0.1)
    assert received.kind == "widget.created"


@pytest.mark.asyncio
async def test_publish_isolated_by_session() -> None:
    bus = EventBus()
    q1 = bus.subscribe("s1")
    q2 = bus.subscribe("s2")
    bus.publish("s1", _event())
    assert q2.empty()
    received = await asyncio.wait_for(q1.get(), timeout=0.1)
    assert received.kind == "widget.created"


@pytest.mark.asyncio
async def test_multiple_subscribers_each_receive() -> None:
    bus = EventBus()
    q1 = bus.subscribe("s1")
    q2 = bus.subscribe("s1")
    bus.publish("s1", _event())
    a = await asyncio.wait_for(q1.get(), timeout=0.1)
    b = await asyncio.wait_for(q2.get(), timeout=0.1)
    assert a.kind == b.kind == "widget.created"


def test_unsubscribe_removes_queue() -> None:
    bus = EventBus()
    q = bus.subscribe("s1")
    bus.unsubscribe("s1", q)
    bus.publish("s1", _event())
    assert q.empty()
