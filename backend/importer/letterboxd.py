import csv
import io
import zipfile

def read_csv_content(file_content):
    text = file_content.decode("utf-8-sig")
    return list(
        csv.DictReader(
            io.StringIO(text)
        )
    )

#take raw movie dictionary and convert it into the structure i want

def normalize_watched_movie(movie):
    return {
        "title": movie["Name"],
        "year": int(movie["Year"]),
        "letterboxd_uri": movie["Letterboxd URI"],
        "watched": True,
        "genres": []
    }

#connects the movies from watched.csv with the ratings from ratings.csv

def add_ratings(movies, ratings):
    ratings_by_uri = {
        rating["Letterboxd URI"]: rating
        for rating in ratings
    }
    for movie in movies:
        rating = ratings_by_uri.get(
            movie["letterboxd_uri"]
        )
        if rating:
            movie["rating"] = float(
                rating["Rating"]
            )
        else:
            movie["rating"] = None
    return movies

def normalize_diary_entry(entry):
    return {
        "movie_uri": entry["Letterboxd URI"],
        "watched_at": entry["Date"],
        "rewatch": entry["Rewatch"] == "Yes"
    }

def import_letterboxd_upload(zip_content):
    with zipfile.ZipFile(io.BytesIO(zip_content)) as zip_file:
        files = {}
        for filename in zip_file.namelist():
            filename_lower = filename.lower()
            if filename_lower == "watched.csv":
                files["watched"] = zip_file.read(filename)
            elif filename_lower == "ratings.csv":
                files["ratings"] = zip_file.read(filename)
            elif filename_lower == "diary.csv":
                files["diary"] = zip_file.read(filename)
        required_files = [
            "watched",
            "ratings",
            "diary"
        ]
        missing_files = [
            file
            for file in required_files
            if file not in files
        ]
        if missing_files:
            raise ValueError(
                "Invalid Letterboxd export. "
                f"Missing: {', '.join(missing_files)}"
            )
        watched = read_csv_content(
            files["watched"]
        )
        ratings = read_csv_content(
            files["ratings"]
        )
        diary = read_csv_content(
            files["diary"]
        )
        
        print("DIARY ROWS:", len(diary))
        print("DIARY FIRST ROW:", diary[0] if diary else "EMPTY")

        return build_letterboxd_data(
            watched,
            ratings,
            diary
        )

def build_letterboxd_data(watched,ratings, diary):
    normalized_watched = [
        normalize_watched_movie(movie)
        for movie in watched
    ]
    normalized_watched = add_ratings(
        normalized_watched,
        ratings
    )
    watch_events = [
        normalize_diary_entry(entry)
        for entry in diary
    ]
    return (normalized_watched, watch_events) 