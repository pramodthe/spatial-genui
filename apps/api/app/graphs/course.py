"""plan -> build the course model -> start the first lesson. Later lessons start when one is opened."""

from __future__ import annotations

from typing import Any, Literal

from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict

from app import courses
from app.graphs.lesson import get_checkpointer


class CourseRun(TypedDict, total=False):
    course_id: str
    status: str


async def plan_node(state: CourseRun) -> dict[str, Any]:
    course = courses.get_course(state["course_id"])
    if course is None:
        return {"status": "failed"}
    await courses.plan(course)
    return {"status": course.get("status") or "failed"}


async def build_model_node(state: CourseRun) -> dict[str, Any]:
    course = courses.get_course(state["course_id"])
    if course and (course.get("model") or {}).get("status") == "building":
        await courses.build_model(course)
    return {"status": (course or {}).get("status") or "failed"}


async def write_lesson_node(state: CourseRun) -> dict[str, Any]:
    course = courses.get_course(state["course_id"])
    if course and course.get("status") == "building":
        courses.queue_first(course)
    return {"status": (course or {}).get("status") or "failed"}


def _after_plan(state: CourseRun) -> Literal["build_model", "write_lesson", "done"]:
    course = courses.get_course(state["course_id"])
    if course is None or course.get("status") == "failed":
        return "done"
    if (course.get("model") or {}).get("status") == "building":
        return "build_model"
    return "write_lesson"


async def done_node(state: CourseRun) -> dict[str, Any]:
    return {"status": state.get("status") or "failed"}


def _graph():
    graph = StateGraph(CourseRun)
    graph.add_node("plan", plan_node)
    graph.add_node("build_model", build_model_node)
    graph.add_node("write_lesson", write_lesson_node)
    graph.add_node("done", done_node)
    graph.add_edge(START, "plan")
    graph.add_conditional_edges("plan", _after_plan)
    graph.add_edge("build_model", "write_lesson")
    graph.add_edge("write_lesson", END)
    graph.add_edge("done", END)
    return graph.compile(checkpointer=get_checkpointer())


async def run_course(course_id: str) -> None:
    graph = _graph()
    config = {"configurable": {"thread_id": course_id}}
    if get_checkpointer() is not None:
        snapshot = await graph.aget_state(config)
        if snapshot is not None and getattr(snapshot, "next", None):
            await graph.ainvoke(None, config)
            return
    await graph.ainvoke({"course_id": course_id}, config)
