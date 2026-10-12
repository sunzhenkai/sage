.PHONY: install check typecheck test build lint deps agent-platform-final agent-platform-final-evidence agent-platform-final-postgres infra-up infra-health infra-down smoke-local

install:
	corepack pnpm install --frozen-lockfile
check:
	corepack pnpm check
typecheck:
	corepack pnpm typecheck
test:
	corepack pnpm test
build:
	corepack pnpm build
lint:
	corepack pnpm lint
smoke-local:
	corepack pnpm smoke:local
deps:
	corepack pnpm check:deps
infra-up:
	docker compose up -d --wait
infra-health:
	docker compose ps
infra-down:
	docker compose down --remove-orphans

agent-platform-final:
	corepack pnpm check:agent-platform-final
agent-platform-final-evidence:
	corepack pnpm evidence:agent-platform-final
agent-platform-final-postgres:
	corepack pnpm test:agent-platform-final:postgres:ephemeral
