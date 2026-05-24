.PHONY: dev backend frontend test lint format setup install clean

# ── Development ───────────────────────────────────────────────────────────────

dev: ## Start backend + frontend in parallel
	@echo "Starting Tiresias dev environment..."
	@trap 'kill 0' SIGINT; \
	  (cd backend && uvicorn api.main:app --reload --host 0.0.0.0 --port 8000) & \
	  (cd frontend && npm run dev) & \
	  wait

backend: ## Start backend only
	cd backend && uvicorn api.main:app --reload --host 0.0.0.0 --port 8000

frontend: ## Start frontend only
	cd frontend && npm run dev

# ── Dependencies ──────────────────────────────────────────────────────────────

install: ## Install all dependencies
	cd backend && pip install -r requirements.txt
	cd frontend && npm install

install-dev: ## Install backend with dev dependencies
	cd backend && pip install -r requirements.txt -r requirements-dev.txt
	cd frontend && npm install

# ── Quality ───────────────────────────────────────────────────────────────────

test: ## Run backend tests
	cd backend && python -m pytest tests/ -v

test-memory: ## Run Memory agent tests only
	cd backend && python -m pytest tests/test_fingerprint.py -v

lint: ## Run ruff + mypy on backend
	cd backend && ruff check . && mypy memory/ oracle/ lineage/ tiresias/ api/

format: ## Auto-format backend (ruff + black)
	cd backend && ruff check --fix . && black .

lint-frontend: ## Run eslint on frontend
	cd frontend && npm run lint

# ── Infrastructure ────────────────────────────────────────────────────────────

setup: ## Create GCP resources (BigQuery datasets, tables)
	bash infra/setup.sh

# ── Demo scripts ──────────────────────────────────────────────────────────────

seed: ## Seed synthetic fingerprint baseline (dev only — not for demo)
	cd backend && python ../scripts/seed_demo.py

trigger-sim: ## Trigger silent failure via BigQuery simulation (dev only)
	@echo "WARNING: SIMULATION_MODE — this edits BigQuery directly, not a real sync"
	cd backend && python ../scripts/trigger_failure.py --mode simulation

trigger-real: ## Trigger silent failure via real HubSpot API + Fivetran sync (demo path)
	cd backend && python ../scripts/trigger_failure.py --mode authentic

# ── Utilities ─────────────────────────────────────────────────────────────────

clean: ## Remove caches and build artifacts
	find backend -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find backend -name "*.pyc" -delete 2>/dev/null || true
	find backend -name ".mypy_cache" -exec rm -rf {} + 2>/dev/null || true
	find backend -name ".ruff_cache" -exec rm -rf {} + 2>/dev/null || true

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'
