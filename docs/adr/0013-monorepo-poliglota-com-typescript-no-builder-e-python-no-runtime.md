# Monorepo poliglota com TypeScript no builder e Python no runtime

O monorepo deve usar TypeScript para o builder visual, validação do flow spec no ambiente do builder e codegen, enquanto o runtime gerado permanece em Python com FastAPI e LangGraph. Essa divisão aceita duas linguagens porque o editor visual naturalmente depende do ecossistema TypeScript e a execução dos agentes deve permanecer próxima da referência real em Python/FastAPI.

## Consequences

O projeto precisa manter uma fronteira clara entre especificação intermediária, codegen e runtime. O runtime gerado não deve depender do builder em produção, e tipos/schemas compartilhados devem ser publicados por JSON Schema ou artefatos equivalentes para evitar divergência entre TypeScript e Python.
