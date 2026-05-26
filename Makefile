.PHONY: up down logs migrate createsuperuser shell-backend seed-scripts

up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f

migrate:
	docker compose exec backend python manage.py migrate

createsuperuser:
	docker compose exec backend python manage.py createsuperuser

shell-backend:
	docker compose exec backend python manage.py shell

seed-scripts:
	docker compose exec backend python manage.py seed_scripts

