"""Artefato gerado a partir de agent.flow.json."""

import json


FLOW = json.loads("{\n  \"id\": \"teste-api-simples\",\n  \"name\": \"Teste Api Simples\",\n  \"version\": \"0.1.0\",\n  \"runtime\": \"langgraph-python\",\n  \"api\": {\n    \"contract\": \"sessions-v1\",\n    \"resourceName\": \"sessions\",\n    \"autoStartOnCreate\": false\n  },\n  \"persistence\": {\n    \"checkpointer\": \"postgres\",\n    \"publicStore\": \"postgres\",\n    \"cache\": \"redis\"\n  },\n  \"llm\": {\n    \"adapter\": \"openai\",\n    \"model\": \"gpt-4.1-mini\",\n    \"apiKeyEnv\": \"OPENAI_API_KEY\",\n    \"baseUrlEnv\": \"OPENAI_BASE_URL\",\n    \"mockEnv\": \"MOCK_LLM\"\n  },\n  \"state\": {\n    \"schemaRef\": \"session_state\"\n  },\n  \"prompts\": [\n    {\n      \"id\": \"system\",\n      \"path\": \"prompts/system.md\",\n      \"version\": \"v1\",\n      \"variables\": [\n        \"session_id\",\n        \"turn\",\n        \"max_turns\",\n        \"user_message\",\n        \"recent_messages\"\n      ]\n    }\n  ],\n  \"schemas\": [\n    {\n      \"id\": \"session_state\",\n      \"path\": \"schemas/session_state.schema.json\"\n    }\n  ],\n  \"nodes\": [\n    {\n      \"id\": \"llm_prompt_1\",\n      \"type\": \"llm_prompt\",\n      \"promptId\": \"system\",\n      \"llm\": {\n        \"adapter\": \"openai\",\n        \"model\": \"gpt-4.1-mini\"\n      },\n      \"position\": {\n        \"x\": 228.09523809523813,\n        \"y\": 132.38095238095235\n      }\n    }\n  ],\n  \"edges\": [\n    {\n      \"from\": \"start\",\n      \"to\": \"llm_prompt_1\"\n    },\n    {\n      \"from\": \"llm_prompt_1\",\n      \"to\": \"end\"\n    }\n  ]\n}")
FLOW_ID = FLOW["id"]
AGENT_ID = FLOW_ID
FLOW_NAME = FLOW["name"]
FLOW_VERSION = FLOW["version"]
API_RESOURCE = FLOW["api"]["resourceName"]
API_CONTRACT = FLOW["api"]["contract"]
LLM_ADAPTER = FLOW["llm"]["adapter"]
LLM_MODEL = FLOW["llm"]["model"]
NODES = [{"id": item["id"], "type": item["type"]} for item in FLOW["nodes"]]
EDGES = [
    {"from": item["from"], "to": item["to"], "condition": item.get("condition")}
    for item in FLOW["edges"]
]
FLOW_TRIGGERS = list(FLOW.get("triggers") or [])
