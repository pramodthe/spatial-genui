"""Background work (course plans, the lesson, game and model queues): every task is kept referenced so it is not
garbage-collected mid-run, its error is logged instead of lost, and all of it is cancelled before the database and
the checkpointer close at shutdown. Interrupted work resumes on the next start (lessons go back to pending)."""

from __future__ import annotations

import asyncio
from typing import Any

_tasks: set[asyncio.Task[Any]] = set()


def track(task: asyncio.Task[Any]) -> asyncio.Task[Any]:
    _tasks.add(task)
    task.add_done_callback(_finished)
    return task


def _finished(task: asyncio.Task[Any]) -> None:
    _tasks.discard(task)
    if task.cancelled():
        return
    error = task.exception()
    if error is not None:
        print(f"Background task failed: {error!r}")


async def shutdown() -> None:
    tasks = list(_tasks)
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
