import json
from datetime import datetime

#figure out which seasons/ep the user watched

def _watched_seasons(show):
    reviews = show.get("reviews", [])
    seasons = []
    for detail in show.get("seasonsWatchedDetail", []):
        season_id = detail.get("seasonId")
        episode_count = detail.get("episodeCount") or 0
        logged = set()
        season_level_log = False
        for review in reviews:
            if review.get("seasonId") != season_id:
                continue
            number = review.get("episodeNumber")
            if number is None:
                season_level_log = True
                continue
            try:
                logged.add(int(number))
            except (TypeError, ValueError):
                continue
        whole_season = season_level_log or not logged
        seasons.append({
            "season_number": detail.get("seasonNumber"),
            "episode_count": episode_count,
            "episodes": None if whole_season else sorted(logged)
        })
    return seasons

#fastapi passes the uploaded json here

def import_serializd(file_content: bytes):
    data = json.loads(file_content)
    shows = data.get("shows", [])
    series = []
    for show in shows:
        premiere_date = show.get("premiereDate")
        year = None
        if premiere_date:
            try:
                year = datetime.fromisoformat(
                    premiere_date.replace("Z", "+00:00")
                ).year
            except ValueError:
                year = None
        watched_seasons = _watched_seasons(show)
        watched_episodes = sum(
            season["episode_count"]
            if season["episodes"] is None
            else len(season["episodes"])
            for season in watched_seasons
        )
        reviews = show.get("reviews", [])
        all_ratings = [
            r for r in (show.get("allRatings") or [])
            if isinstance(r, (int, float))
        ]
        series.append({
            "likes": sum(1 for r in reviews if r.get("like")),
            "log_count": len(reviews),
            "avg_all_rating": (
                sum(all_ratings) / len(all_ratings)
                if all_ratings else 0
            ),
            "tmdb_id": show.get("showId"),
            "watched_seasons": watched_seasons,
            "watched_episodes": watched_episodes,
            "title": show.get("name"),
            "year": year,
            "rating": show.get("rating"),
            "genres": show.get("genres", []),
            "num_seasons": show.get("numSeasons", 0),
            "num_episodes": show.get("numEpisodes", 0),
            "status": show.get("status"),
            "networks": show.get("networks", []),
            "tagline": show.get("tagline"),
            "summary": show.get("summary"),
            "banner": show.get("bannerImage"),
            "reviews": show.get("reviews", [])
        })
    return series

#create the final json structure 

def build_series_data(series, enrichment=None):
    total_titles = len(series)
    total_episodes = sum(
        show.get("watched_episodes", show.get("num_episodes", 0)) or 0
        for show in series
    )
    rated_series = [
        show
        for show in series
        if show.get("rating") is not None
    ]
    if rated_series:
        total_rating = sum(
            show["rating"]
            for show in rated_series
        )
        avg_rating = round(
            total_rating / len(rated_series),
            1
        )
    else:
        avg_rating = None
    # GENRES
    genres = {}
    for show in series:
        for genre in show.get("genres", []):
            if genre not in genres:
                genres[genre] = 0
            genres[genre] += 1
    genre_data = [
        {
            "name": genre,
            "count": count
        }
        for genre, count in genres.items()
    ]
    genre_data.sort(
        key=lambda genre: genre["count"],
        reverse=True
    )
    # FAVOURITES
    def favourite_key(show):
        return (
            show.get("rating") or 0,
            show.get("avg_all_rating") or 0,
            show.get("likes") or 0,
            show.get("log_count") or 0,
            show.get("watched_episodes") or 0
        )
    def card(show):
        genres = show.get("genres") or []
        episodes = show.get("watched_episodes") or 0
        genre = genres[0] if genres else "Series"
        return {
            "title": show["title"],
            "rating": show.get("rating"),
            "genre": genre,
            "scale": 10,
            "episodes": episodes,
            "meta": (
                f"{genre} · {episodes} eps"
                if episodes else genre
            ),
            "poster": show.get("poster") or show.get("banner")
        }
    ranked = sorted(
        series,
        key=favourite_key,
        reverse=True
    )
    top_picks = [
        card(show)
        for show in ranked
        if show.get("rating") is not None
    ][:5]
    all_series = [card(show) for show in ranked]
    # ACTIVITY
    monthly = [0] * 12
    daily = [0] * 7
    watch_dates = []
    for show in series:
        for review in show.get("reviews", []):
            date_string = (
                review.get("backdate")
                or review.get("dateAdded")
            )
            if not date_string:
                continue
            try:
                date = datetime.fromisoformat(
                    date_string.replace("Z", "+00:00")
                )
                monthly[date.month - 1] += 1
                daily[date.weekday()] += 1
                watch_dates.append(date_string)
            except ValueError:
                continue
    # PEAK MONTH
    highest_month = max(monthly)
    peak_month_index = monthly.index(
        highest_month
    )
    months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December"
    ]
    peak_month = (
        months[peak_month_index]
        if highest_month > 0
        else "—"
    )
    # PEAK DAY
    highest_day = max(daily)
    peak_day_index = daily.index(
        highest_day
    )
    days = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday"
    ]
    peak_day = (
        days[peak_day_index]
        if highest_day > 0
        else "—"
    )
    # TOTAL HOURS
    total_hours = round(
        sum(
            show.get("watched_hours", 0) or 0
            for show in series
        )
    )
    return {
        "dataVersion": 2,
        "enrichment": enrichment or {},
        "year": 2026,
        "scale": 10,
        "label": "Series",
        "tagline":
            "The series you watched, rated, and remembered.",
        "stats": {
            "totalTitles": total_titles,
            "totalHours": total_hours,
            "totalEpisodes": total_episodes,
            "avgRating": avg_rating
        },
        "moodLine": (
            f"You were really into "
            f"{genre_data[0]['name'].lower()} "
            f"this year."
            if genre_data
            else
            "A year filled with series worth remembering."
        ),
        "peakMonth": peak_month,
        "peakDay": peak_day,
        "topPicks": top_picks,
        "allSeries": all_series,
        "watchDates": watch_dates,
        "genres": genre_data,
        "monthly": monthly,
        "daily": daily
    }