# WEEEK MCP Server

## What This Is

MCP (Model Context Protocol) сервер для интеграции AI-агентов с таск-трекером WEEEK. Позволяет кодинг-агентам (Claude Desktop, Cursor, и др.) читать задачи, обновлять статусы, оставлять комментарии и навигировать по проектам/доскам через WEEEK Public API. Распространяется как npm-пакет (`weeek-mcp-server`), запускается через `npx`.

## Core Value

Кодинг-агенты получают прямой доступ к контексту задач в WEEEK — без переключения контекста разработчиком.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Получение списка проектов и навигация по ним
- [ ] Получение досок и их колонок внутри проекта
- [ ] Получение списка задач с фильтрацией
- [ ] Получение детальной информации по задаче
- [ ] Создание задач
- [ ] Обновление задач (название, описание, приоритет, исполнитель)
- [ ] Перемещение задачи между колонками доски (управление статусом)
- [ ] Завершение/возобновление задач
- [ ] Комментарии к задачам (чтение и создание)
- [ ] Авторизация через WEEEK_API_TOKEN (env variable)
- [ ] Разделение тулов на read и write для контроля через MCP клиент
- [ ] Дистрибуция через npx (`npx weeek-mcp-server`)

### Out of Scope

- CRM модуль WEEEK — не в скоупе v1, фокус на таск-трекере
- База знаний WEEEK — не в скоупе v1
- Удаление задач — деструктивная операция, слишком опасно для AI-агентов
- OAuth авторизация — Bearer token достаточен для v1
- Docker/SSE транспорт — stdio через npx покрывает основные клиенты
- Управление воркспейсом (создание проектов, досок) — фокус на работе с задачами

## Context

- WEEEK (https://weeek.net) — российский сервис управления проектами с таск-трекером, CRM и базой знаний
- WEEEK Public API v1: https://developers.weeek.net/api — REST API с Bearer token авторизацией
- Существует Python-реализация MCP сервера (AlekMel/weeek-mcp-server) с покрытием всех 71 эндпоинтов — наш сервер будет на TypeScript, сфокусирован на таск-трекере, с более простой установкой через npx
- Целевая аудитория: разработчики, использующие AI-агентов для кодинга, чьи задачи живут в WEEEK
- Основные сценарии: агент читает задачу и реализует её; агент показывает актуальные задачи; агент обновляет статус/оставляет комментарий

## Constraints

- **Tech stack**: TypeScript, MCP SDK (`@modelcontextprotocol/sdk`), npm package
- **API**: WEEEK Public API v1 — все возможности ограничены тем, что предоставляет API
- **Transport**: stdio (стандарт для npx MCP серверов)
- **Auth**: Bearer token через переменную окружения WEEEK_API_TOKEN

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript вместо Python | Простая дистрибуция через npx, нет зависимости от Python runtime | — Pending |
| Только таск-трекер в v1 | Фокус на главном use-case — управление задачами для кодинг-агентов | — Pending |
| Без delete операций | Защита от нежелательных действий AI — деструктивные операции слишком рискованны | — Pending |
| Read/write разделение тулов | Позволяет пользователю настроить auto-approve для read, confirmation для write | — Pending |
| Env variable для токена | Стандарт для MCP серверов, поддерживается всеми клиентами | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-08 after initialization*
