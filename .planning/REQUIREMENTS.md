# Requirements: WEEEK MCP Server

**Defined:** 2026-04-08
**Core Value:** Кодинг-агенты получают прямой доступ к контексту задач в WEEEK — без переключения контекста разработчиком

## v1 Requirements

### Infrastructure

- [x] **INFRA-01**: MCP сервер запускается через stdio transport (`@modelcontextprotocol/sdk`)
- [x] **INFRA-02**: Авторизация через переменную окружения `WEEEK_API_TOKEN`
- [x] **INFRA-03**: Централизованный API-клиент (`WeeekApiClient`) для всех запросов к WEEEK API
- [x] **INFRA-04**: Все логи идут в stderr, не в stdout (защита stdio транспорта)
- [x] **INFRA-05**: Ошибки API возвращаются через `isError: true`, tool handlers не бросают исключения
- [x] **INFRA-06**: Разделение тулов на read-group и write-group (для клиентских auto-approve настроек)
- [x] **INFRA-07**: Ответы tools ограничены по размеру (field selection, default limit для списков)

### Navigation

- [x] **NAV-01**: Тул `weeek_list_projects` — список проектов воркспейса
- [x] **NAV-02**: Тул `weeek_get_project` — детали проекта по ID
- [x] **NAV-03**: Тул `weeek_list_boards` — доски внутри проекта
- [x] **NAV-04**: Тул `weeek_list_board_columns` — колонки доски (нужно для определения статусов и Move операции)

### Tasks — Read

- [x] **TASK-01**: Тул `weeek_list_tasks` — список задач с фильтрацией (по проекту/доске/статусу/исполнителю)
- [x] **TASK-02**: Тул `weeek_get_task` — детальная информация о задаче по ID
- [x] **TASK-03**: Пагинация задач с дефолтным лимитом (защита от превышения 25K токенов в ответе)

### Tasks — Write

- [x] **TASK-04**: Тул `weeek_create_task` — создание задачи (название, описание, проект, доска, приоритет, исполнитель)
- [x] **TASK-05**: Тул `weeek_update_task` — обновление полей задачи (название, описание, приоритет, исполнитель)
- [ ] **TASK-06**: Тул `weeek_move_task` — перемещение задачи между колонками доски (управление статусом)
- [ ] **TASK-07**: Тул `weeek_complete_task` — завершение/возобновление задачи

### Comments

- [x] **CMNT-01**: Тул `weeek_list_task_comments` — список комментариев к задаче
- [ ] **CMNT-02**: Тул `weeek_create_task_comment` — создание комментария к задаче

### Distribution

- [ ] **DIST-01**: npm-пакет `weeek-mcp-server` с `bin` полем для CLI
- [ ] **DIST-02**: Запуск через `npx weeek-mcp-server` без предварительной установки
- [ ] **DIST-03**: TypeScript компилируется в ESM (NodeNext), shebang в entry point
- [ ] **DIST-04**: README с примерами конфигов для Claude Desktop, Cursor, и других MCP клиентов
- [ ] **DIST-05**: README содержит workaround для NVM + npx проблемы (GUI клиенты не видят PATH)

### Quality

- [ ] **QUAL-01**: Каждый тул имеет качественное описание (когда использовать, чем отличается от похожих)
- [ ] **QUAL-02**: Zod-схемы для валидации входных параметров всех тулов
- [ ] **QUAL-03**: Живые тесты против WEEEK API (или мокнутые интеграционные тесты)

## v2 Requirements

### Advanced Navigation

- **NAV2-01**: Поддержка вложенных проектов (проекты внутри проектов)
- **NAV2-02**: Тул `weeek_get_current_user` — информация о текущем пользователе для "my tasks"

### Subtasks

- **SUB-01**: Работа с подзадачами (создание, обновление)

### Search

- **SRCH-01**: Глобальный поиск задач по тексту

### Other WEEEK modules

- **CRM-01**: Интеграция с CRM модулем WEEEK
- **KB-01**: Интеграция с базой знаний WEEEK

## Out of Scope

| Feature | Reason |
|---------|--------|
| Delete task/project/board | Слишком деструктивно для AI-агентов — риск потери данных без возможности отката |
| Bulk operations | Высокий риск нежелательных массовых изменений |
| OAuth авторизация | Bearer token через env достаточен для v1, OAuth добавляет сложность без явного выигрыша |
| SSE/HTTP transport | stdio через npx покрывает основные MCP клиенты (Claude Desktop, Cursor) |
| Docker дистрибуция | npx уже обеспечивает простой zero-config запуск |
| Управление воркспейсом (создание проектов/досок) | Фокус на работе с существующими задачами, а не на администрировании |
| Webhooks / события | Pull-модель через MCP тулы достаточна для агентов |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Complete |
| INFRA-02 | Phase 1 | Complete |
| INFRA-03 | Phase 1 | Complete |
| INFRA-04 | Phase 1 | Complete |
| INFRA-05 | Phase 1 | Complete |
| INFRA-06 | Phase 1 | Complete |
| INFRA-07 | Phase 1 | Complete |
| NAV-01 | Phase 2 | Complete |
| NAV-02 | Phase 2 | Complete |
| NAV-03 | Phase 2 | Complete |
| NAV-04 | Phase 2 | Complete |
| TASK-01 | Phase 2 | Complete |
| TASK-02 | Phase 2 | Complete |
| TASK-03 | Phase 2 | Complete |
| TASK-04 | Phase 3 | Complete |
| TASK-05 | Phase 3 | Complete |
| TASK-06 | Phase 3 | Pending |
| TASK-07 | Phase 3 | Pending |
| CMNT-01 | Phase 2 | Complete |
| CMNT-02 | Phase 3 | Pending |
| DIST-01 | Phase 4 | Pending |
| DIST-02 | Phase 4 | Pending |
| DIST-03 | Phase 4 | Pending |
| DIST-04 | Phase 4 | Pending |
| DIST-05 | Phase 4 | Pending |
| QUAL-01 | Phase 4 | Pending |
| QUAL-02 | Phase 4 | Pending |
| QUAL-03 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0

---
*Requirements defined: 2026-04-08*
*Last updated: 2026-04-08 — traceability filled after roadmap creation*
