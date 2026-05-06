import os
from flask import Flask, render_template, request, jsonify, send_from_directory, Response
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "bookmarks.db")

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + DB_PATH
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB max upload

db = SQLAlchemy(app)

_db_initialized = False

@app.before_request
def initialize_database():
    global _db_initialized
    if not _db_initialized:
        db.create_all()
        _db_initialized = True


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Group(db.Model):
    __tablename__ = "groups"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    position = db.Column(db.Integer, default=0)
    bookmarks = db.relationship(
        "Bookmark", backref="group", cascade="all, delete-orphan", lazy=True,
        order_by="Bookmark.position"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "position": self.position,
            "bookmarks": [b.to_dict() for b in self.bookmarks],
        }


class Bookmark(db.Model):
    __tablename__ = "bookmarks"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    url = db.Column(db.Text, nullable=False)
    icon = db.Column(db.Text, default="")
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=False)
    position = db.Column(db.Integer, default=0)

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "url": self.url,
            "icon": self.icon,
            "group_id": self.group_id,
            "position": self.position,
        }


# ---------------------------------------------------------------------------
# Main page
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/settings")
def settings():
    return render_template("settings.html")


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/download-icon")
def download_icon():
    return send_from_directory(
        os.path.join(BASE_DIR, "static"),
        "icon.svg",
        as_attachment=True,
        download_name="bookmark-manager-icon.svg",
        mimetype="image/svg+xml",
    )


@app.route("/export-bookmarks")
def export_bookmarks():
    groups = Group.query.order_by(Group.position).all()
    payload = []
    for group in groups:
        payload.append({
            "name": group.name,
            "bookmarks": [
                {
                    "title": bm.title,
                    "url": bm.url,
                    "icon": bm.icon,
                    "position": bm.position,
                }
                for bm in group.bookmarks
            ],
            "position": group.position,
        })

    body = jsonify({"groups": payload}).get_data(as_text=True)
    return Response(
        body,
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=bookmark-export.json"},
    )


@app.route("/api/clean-duplicates", methods=["POST"])
def clean_duplicates():
    bookmarks = Bookmark.query.join(Group).order_by(Group.position, Bookmark.position, Bookmark.id).all()
    seen = set()
    removed = 0

    for bm in bookmarks:
        normalized = bm.url.strip().lower().rstrip("/")
        if normalized in seen:
            db.session.delete(bm)
            removed += 1
        else:
            seen.add(normalized)

    if removed > 0:
        db.session.commit()
        # Reindex positions within each group after removals
        for group in Group.query.order_by(Group.position).all():
            for index, bm in enumerate(group.bookmarks):
                bm.position = index
        db.session.commit()

    return jsonify({"removed": removed})


@app.route("/api/delete-empty-groups", methods=["POST"])
def delete_empty_groups():
    empty_groups = Group.query.outerjoin(Bookmark).filter(Bookmark.id == None).all()
    deleted = 0
    for group in empty_groups:
        db.session.delete(group)
        deleted += 1
    if deleted > 0:
        db.session.commit()
    return jsonify({"deleted": deleted})


# ---------------------------------------------------------------------------
# API – data
# ---------------------------------------------------------------------------

@app.route("/api/data")
def api_data():
    groups = Group.query.order_by(Group.position).all()
    return jsonify([g.to_dict() for g in groups])


# ---------------------------------------------------------------------------
# API – groups
# ---------------------------------------------------------------------------

@app.route("/api/groups", methods=["POST"])
def create_group():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    max_pos = db.session.query(db.func.max(Group.position)).scalar() or 0
    group = Group(name=name, position=max_pos + 1)
    db.session.add(group)
    db.session.commit()
    return jsonify(group.to_dict()), 201


@app.route("/api/groups/<int:group_id>", methods=["PUT"])
def update_group(group_id):
    group = db.session.get(Group, group_id)
    if group is None:
        return jsonify({"error": "not found"}), 404
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    group.name = name
    db.session.commit()
    return jsonify(group.to_dict())


@app.route("/api/groups/<int:group_id>", methods=["DELETE"])
def delete_group(group_id):
    group = db.session.get(Group, group_id)
    if group is None:
        return jsonify({"error": "not found"}), 404
    db.session.delete(group)
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# API – bookmarks
# ---------------------------------------------------------------------------

@app.route("/api/bookmarks", methods=["POST"])
def create_bookmark():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    url = (data.get("url") or "").strip()
    group_id = data.get("group_id")
    if not title or not url or not group_id:
        return jsonify({"error": "title, url and group_id are required"}), 400
    group = db.session.get(Group, group_id)
    if group is None:
        return jsonify({"error": "group not found"}), 404
    max_pos = db.session.query(db.func.max(Bookmark.position)).filter_by(group_id=group_id).scalar() or 0
    bookmark = Bookmark(
        title=title,
        url=url,
        icon=data.get("icon", ""),
        group_id=group_id,
        position=max_pos + 1,
    )
    db.session.add(bookmark)
    db.session.commit()
    return jsonify(bookmark.to_dict()), 201


@app.route("/api/bookmarks/total", methods=["GET"])
def total_bookmarks():
    total = db.session.query(db.func.count(Bookmark.id)).scalar() or 0
    return jsonify({"total": total})


@app.route("/api/bookmarks/<int:bookmark_id>", methods=["PUT"])
def update_bookmark(bookmark_id):
    bookmark = db.session.get(Bookmark, bookmark_id)
    if bookmark is None:
        return jsonify({"error": "not found"}), 404
    data = request.get_json(silent=True) or {}
    title = data.get("title")
    url = data.get("url")

    if title is not None:
        title = title.strip()
        if not title:
            return jsonify({"error": "title cannot be empty"}), 400
        bookmark.title = title

    if url is not None:
        url = url.strip()
        if not url:
            return jsonify({"error": "url cannot be empty"}), 400
        bookmark.url = url

    if "icon" in data:
        bookmark.icon = data["icon"]

    if "group_id" in data:
        group = db.session.get(Group, data["group_id"])
        if group is None:
            return jsonify({"error": "group not found"}), 404
        bookmark.group_id = data["group_id"]

    db.session.commit()
    return jsonify(bookmark.to_dict())


@app.route("/api/bookmarks/<int:bookmark_id>", methods=["DELETE"])
def delete_bookmark(bookmark_id):
    bookmark = db.session.get(Bookmark, bookmark_id)
    if bookmark is None:
        return jsonify({"error": "not found"}), 404
    db.session.delete(bookmark)
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# API – import Netscape HTML bookmarks
# ---------------------------------------------------------------------------

from html.parser import HTMLParser


class _BookmarkHTMLParser(HTMLParser):
    """Parse a Netscape Bookmark HTML file.

    Produces ``flat``: a list of (group_name, [bookmark_dict, ...]) tuples.
    Each folder in the HTML becomes its own group; nesting is preserved only
    in the group name (leaf name used by default, no path prefix).
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._stack = []           # [{name, bookmarks}]
        self._pending_name = None  # H3 text waiting for the next <DL>
        self._in_h3 = False
        self._in_a = False
        self._cur_attrs = {}
        self._cur_text = ""
        self.flat = []             # final result

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        attrs_d = {k.lower(): v for k, v in attrs}
        if tag == "dl":
            if self._pending_name is not None:
                self._stack.append({"name": self._pending_name, "bookmarks": []})
                self._pending_name = None
        elif tag == "h3":
            self._in_h3 = True
            self._cur_text = ""
        elif tag == "a":
            self._in_a = True
            self._cur_attrs = attrs_d
            self._cur_text = ""

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag == "h3":
            self._in_h3 = False
            self._pending_name = self._cur_text.strip()
        elif tag == "a":
            self._in_a = False
            title = self._cur_text.strip()
            url = (self._cur_attrs.get("href") or "").strip()
            icon = self._cur_attrs.get("icon", "")
            if title and url:
                if self._stack:
                    self._stack[-1]["bookmarks"].append(
                        {"title": title, "url": url, "icon": icon}
                    )
                else:
                    # Bookmark outside any folder → Uncategorized
                    if not self.flat or self.flat[-1][0] != "Uncategorized":
                        self.flat.append(("Uncategorized", []))
                    self.flat[-1][1].append({"title": title, "url": url, "icon": icon})
        elif tag == "dl":
            if self._stack:
                group = self._stack.pop()
                if group["bookmarks"]:
                    self.flat.append((group["name"], group["bookmarks"]))

    def handle_data(self, data):
        if self._in_h3 or self._in_a:
            self._cur_text += data


@app.route("/api/import", methods=["POST"])
def import_html():
    if "file" not in request.files:
        return jsonify({"error": "no file provided"}), 400
    f = request.files["file"]
    if f.filename == "":
        return jsonify({"error": "no file selected"}), 400
    filename = secure_filename(f.filename)
    if not filename.lower().endswith(".html"):
        return jsonify({"error": "only Netscape .html bookmark files are accepted"}), 400

    try:
        content = f.read().decode("utf-8", errors="replace")
    except Exception:
        return jsonify({"error": "could not read file"}), 400

    parser = _BookmarkHTMLParser()
    parser.feed(content)

    if not parser.flat:
        return jsonify({"error": "no bookmark folders found in file"}), 400

    def normalize_url(raw_url: str) -> str:
        return raw_url.strip().lower().rstrip("/")

    existing_urls = {
        normalize_url(url)
        for (url,) in db.session.query(Bookmark.url).all()
        if url
    }

    max_group_pos = db.session.query(db.func.max(Group.position)).scalar() or 0
    imported_groups = 0
    imported_bookmarks = 0
    skipped_duplicates = 0

    for group_name, bookmarks in parser.flat:
        group = None
        position = 0

        for bm in bookmarks:
            title = (bm.get("title") or "").strip()
            url = (bm.get("url") or "").strip()
            if not title or not url:
                continue

            normalized = normalize_url(url)
            if normalized in existing_urls:
                skipped_duplicates += 1
                continue

            existing_urls.add(normalized)
            if group is None:
                max_group_pos += 1
                group = Group(name=group_name, position=max_group_pos)
                db.session.add(group)
                db.session.flush()

            bookmark = Bookmark(
                title=title,
                url=url,
                icon=bm.get("icon", ""),
                group_id=group.id,
                position=position,
            )
            db.session.add(bookmark)
            imported_bookmarks += 1
            position += 1

        if group is not None:
            imported_groups += 1

    db.session.commit()
    return jsonify({
        "imported_groups": imported_groups,
        "imported_bookmarks": imported_bookmarks,
        "skipped_duplicates": skipped_duplicates,
    })


# ---------------------------------------------------------------------------
# API – reorder (drag and drop)
# ---------------------------------------------------------------------------

@app.route("/api/reorder", methods=["POST"])
def reorder():
    """
    Expects JSON body:
    {
      "groups": [{"id": 1, "position": 0}, ...],           # optional
      "bookmarks": [{"id": 5, "group_id": 2, "position": 0}, ...]  # optional
    }
    """
    data = request.get_json(silent=True) or {}

    for item in data.get("groups", []):
        group = db.session.get(Group, item.get("id"))
        if group:
            group.position = item.get("position", group.position)

    for item in data.get("bookmarks", []):
        bookmark = db.session.get(Bookmark, item.get("id"))
        if bookmark:
            bookmark.position = item.get("position", bookmark.position)
            if "group_id" in item:
                group = db.session.get(Group, item["group_id"])
                if group:
                    bookmark.group_id = item["group_id"]

    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=7101, host="0.0.0.0")
