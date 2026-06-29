# Baseline com Docker Compose, Postgres e Redis

O baseline deve incluir Dockerfile, Docker Compose, Postgres, Redis, `.env.example`, migrations e testes. Como o runtime de referência precisa provar checkpointer PostgreSQL, tabelas públicas e cache quente, o ambiente de referência deve exercitar essas dependências desde o início, mantendo fallback para testes quando apropriado.
