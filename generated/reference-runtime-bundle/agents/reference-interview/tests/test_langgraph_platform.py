import importlib
import sys

from tests.conftest import set_test_env


def test_langgraph_platform_entrypoint_loads_and_invokes(tmp_path):
    set_test_env(str(tmp_path / "langgraph-platform.db"))
    sys.modules.pop("app.langgraph_app", None)

    module = importlib.import_module("app.langgraph_app")
    assert hasattr(module.graph, "invoke")
    from app.graph import START_NODE_IDS

    result = module.graph.invoke(
        {
            "action": "start",
            "session_id": "platform-smoke",
            "status": "created",
            "phase": "created",
            "turn": 0,
            "max_turns": 3,
            "executed_nodes": [],
        },
        config={"configurable": {"thread_id": "platform-smoke"}},
    )
    assert result["assistant_message"]["code"] == "ABR"
    assert START_NODE_IDS[0] in result["executed_nodes"]
