# Samoora Meal Planner

A gift for one person. The menu lives in a SQLite file the page loads in the browser. BMI, fasting, preferences, plans, ratings, and weight stay in that browser. Nothing is sent anywhere.

## Publish on GitHub Pages

1. Push this folder to a GitHub repository.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Choose the `main` branch and the `/ (root)` folder, then save.

There is no build step. The site is ready as soon as GitHub finishes that first deploy.

## Refresh the menu

Replace `data/cookunity_east_coast_public_menu_2026-10-08.xlsx` if you have a newer crawl, then run:

```bash
python3 scripts/build_menu_db.py
```

Commit `data/menu.sqlite` with the spreadsheet.
