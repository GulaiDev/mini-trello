# MySQL 首次初始化时执行（仅在数据卷为空时运行一次）。
# 额外创建测试库，使 `docker compose exec api pytest -q` 可直接在容器内跑测试。
CREATE DATABASE IF NOT EXISTS mini_trello
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;

CREATE DATABASE IF NOT EXISTS mini_trello_test
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;
