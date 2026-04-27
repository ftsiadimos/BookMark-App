# Bookmark Manager

A Flask-based bookmark manager that imports Netscape-format bookmark HTML files, stores bookmark groups and tiles in SQLite, and provides a searchable tile UI.

## Features

- Import bookmark HTML files exported from browsers
- Automatically create groups from bookmark folders
- Display bookmarks as tile cards with favicon support
- Search bookmarks by title, URL, or category
- Add, edit, delete bookmarks and groups
- Drag-and-drop reordering of bookmarks and groups
- Selection mode for bulk bookmark selection and moving
- Export current bookmarks as a JSON backup
- Clean duplicate bookmarks and remove empty groups
- Settings and About pages
- Persistent storage with SQLite
- Docker and Docker Compose support

## Quick start

### Local development

```bash
cd bookmark-app
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then open `http://127.0.0.1:7101` in your browser.

### Import bookmarks

Use the **Import Bookmarks HTML** button and select a `.html` bookmark file exported from your browser. The app will create groups from bookmark folders and add bookmarks into the corresponding category.

### Selection mode

Click the **Select** button in the top bar to enable tile selection. When selection mode is active, each bookmark tile shows a checkbox control and group actions let you select all or move selected bookmarks to another group.

## Docker

Build the image:

```bash
docker build -t bookmark-app .
```

Run the container:

```bash
docker run -p 7101:7101 bookmark-app
```

## Docker Compose

Start the app with Compose:

```bash
docker compose up --build
```

The app will be available at `http://localhost:7101`.

## Project files

- `app.py` — Flask application, models, API endpoints, HTML import parser
- `requirements.txt` — Python dependencies
- `Dockerfile` — container build instructions
- `docker-compose.yml` — Compose service definition
- `templates/index.html` — frontend UI
- `templates/settings.html` — settings page UI
- `static/css/style.css` — styles
- `static/js/app.js` — client-side behavior and API integration

## Notes

- The app listens on port `7101`.
- Imported bookmarks are stored in `data/bookmarks.db` or `bookmarks.db` depending on deployment.
- If the import file contains nested folders, each folder becomes a group.
- Bookmarks outside folders are placed into an `Uncategorized` group.
- Use the Settings page to export bookmarks, clean duplicates, and remove empty groups.
