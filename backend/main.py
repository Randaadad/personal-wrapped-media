from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware #CORS = Cross-Origin Resource Sharing

import zipfile
from importer.letterboxd import (
    import_letterboxd_upload
)
from importer.serializd import (
    import_serializd,
    build_series_data
)

import os
from dotenv import load_dotenv
import httpx
import asyncio
import json

# CONFIGURATION

load_dotenv()

TMDB_API_KEY = os.getenv("TMDB_API_KEY")
TMDB_CACHE_FILE = os.getenv(
    "TMDB_CACHE_FILE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "tmdb_cache.json")
)

# DICTIONARY TMDB GENRES (genre in tmdb uses ids)

TMDB_GENRES = {
    28: "Action",
    12: "Adventure",
    16: "Animation",
    35: "Comedy",
    80: "Crime",
    99: "Documentary",
    18: "Drama",
    10751: "Family",
    14: "Fantasy",
    36: "History",
    27: "Horror",
    10402: "Music",
    9648: "Mystery",
    10749: "Romance",
    878: "Science Fiction",
    10770: "TV Movie",
    53: "Thriller",
    10752: "War",
    37: "Western"
}

# LOAD TMDB CACHE (save data)

try:
    with open(
        TMDB_CACHE_FILE,
        "r",
        encoding="utf-8"
    ) as file:

        tmdb_cache = json.load(file)

except (FileNotFoundError, ValueError):

    tmdb_cache = {}

# FASTAPI

app = FastAPI()


# Health check
async def health():
    return {"status": "ok"}

MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "100"))

#get the upload from user read it and check if it have the right size

async def read_upload(file: UploadFile) -> bytes:
    content = await file.read()

    if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"File is too large (max {MAX_UPLOAD_MB} MB)."
        )

    return content

# CORS which origin can access my api 

ALLOWED_ORIGINS = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
] + [
    origin.strip().rstrip("/")
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]

#conditions

app.add_middleware(
    CORSMiddleware,

    allow_origins=ALLOWED_ORIGINS,

    allow_credentials=False,

    allow_methods=["*"],

    allow_headers=["*"],
)

# TMDB MOVIE SEARCH

async def search_tmdb_movie(title: str, year: int):
#unique key for the movie
    cache_key = f"{title}::{year}"

    # CHECK CACHE

    if cache_key in tmdb_cache:
        cached_movie = tmdb_cache[cache_key]
        if "runtime" in cached_movie: #the time of the movie
            return cached_movie

    # SEARCH MOVIE

    search_url = (
        "https://api.themoviedb.org/3/search/movie"
    )

    search_params = {
        "api_key": TMDB_API_KEY,
        "query": title,
        "year": year,
        "language": "en-US"
    }

    #asyns context manager
    
    async with httpx.AsyncClient( 
        timeout=20.0
    ) as client:

        response = await client.get(
            search_url,
            params=search_params
        )
        data = response.json()

        if not data.get("results"):
            return None

        movie = data["results"][0]
        movie_id = movie["id"]

        # GET FULL MOVIE DETAILS

        details_url = (
            f"https://api.themoviedb.org/3/movie/{movie_id}"
        )

        details_params = {
            "api_key": TMDB_API_KEY,
            "language": "en-US"
        }


        details_response = await client.get(
            details_url,
            params=details_params
        )

        details = details_response.json()

    # ADD GENRE IDS

    details["genre_ids"] = [
        genre["id"]
        for genre in details.get(
            "genres",
            []
        )
    ]

    # SAVE TO CACHE (in memory only; written to disk once per import)

    tmdb_cache[cache_key] = details

    return details

# Movie Search 

@app.get("/api/tmdb/movie")
async def get_tmdb_movie(
    title: str,
    year: int
):

    movie = await search_tmdb_movie(
        title,
        year
    )

    return movie

#MOVIE ENRICHMENT (for testing before i used import)
# @app.get("/api/tmdb/enrich")
# async def enrich_movie(title: str, year: int):

#     movie = await search_tmdb_movie(title, year)
#     if movie is None:
#         return {
#             "title": title,
#             "year": year,
#             "tmdb": None
#         }
#     return {
#         "title": title,
#         "year": year,
#         "tmdb": { #specify the data i need only
#             "id": movie["id"],
#             "title": movie["title"],
#             "poster_path": movie["poster_path"],
#             "backdrop_path": movie["backdrop_path"],
#             "tmdb_rating": movie["vote_average"],
#             "release_date": movie["release_date"]
#         }
#     }

# TMDB MOVIE SEARCH

# @app.get("/api/tmdb/search")
# async def search_movie(
#     title: str
# ):
#     url = (
#         "https://api.themoviedb.org/3/search/movie"
#     )
#     params = {
#         "api_key": TMDB_API_KEY,
#         "query": title,
#         "language": "en-US"
#     }
#     async with httpx.AsyncClient(
#         timeout=10.0
#     ) as client:
#         response = await client.get(
#             url,
#             params=params
#         )
#     return response.json()


#Movies import

@app.post("/api/movies/import")
async def import_movies(file: UploadFile = File(...)):

    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(
            status_code=400,
            detail="Please upload your Letterboxd ZIP file."
        )

    try:
        # READ ZIP
        zip_content = await read_upload(file)
        # IMPORT LETTERBOXD
        movies, watch_events = import_letterboxd_upload(zip_content)

        # TMDB ENRICHMENT

        semaphore = asyncio.Semaphore(5) #to send requests 5 at a time

        async def enrich_movie(movie):
            async with semaphore:
                try:
                    tmdb_movie = await search_tmdb_movie(
                        movie["title"],
                        movie["year"]
                    )
                except Exception as e:
                    print(
                        f"TMDB error for "
                        f"{movie['title']}: {e}"
                    )
                    tmdb_movie = None
                return {
                    "title": movie["title"],
                    "year": movie["year"],
                    "letterboxd_rating": movie["rating"],
                    "genres": [
                        TMDB_GENRES[genre_id]
                        for genre_id in (
                            tmdb_movie.get(
                                "genre_ids",
                                [])
                            if tmdb_movie
                            else [])
                        if genre_id in TMDB_GENRES],
                    "tmdb": tmdb_movie
                }
        #run all movies and wait until they are finished
        enriched_movies = await asyncio.gather(
            *(
                enrich_movie(movie)
                for movie in movies
            ))
        _save_cache(tmdb_cache)
        return {
            "movies": enriched_movies,
            "watch_events": watch_events
        }

    except HTTPException:
        raise
    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=400,
            detail="Invalid ZIP file."
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e)
        )
    except Exception as e:
        print(
            f"Letterboxd import error: {e}"
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to import Letterboxd data."
        )

TMDB_BASE_URL = "https://api.themoviedb.org/3"

# Used only when TMDB has no runtime for an episode.
RUNTIME_ANIMATION = 24
RUNTIME_COMEDY = 25
RUNTIME_DEFAULT = 45

# AUTH
def _api_key():
    return (os.getenv("TMDB_API_KEY") or "").strip().strip('"').strip("'")

def _auth():
    key = _api_key()

    if key.startswith("eyJ"):
        return {"Authorization": f"Bearer {key}"}, {}
    return {}, {"api_key": key}

#custom tmdb error
class TMDBAuthError(Exception):
    pass
#The idea is to keep TMDB results that you've already fetched.
def _load_cache():
    return tmdb_cache

def _save_cache(cache):
    try:
        with open(TMDB_CACHE_FILE, "w", encoding="utf-8") as file:
            json.dump(cache, file)
    except OSError as error:
        print(f"Could not save TMDB cache: {error}")

# HTTP

async def _get(client, path, params=None, retries=4):
    """
    Returns parsed JSON, or None for 404 / persistent failure.
    Raises TMDBAuthError on 401.
    """
    headers, auth_params = _auth()

    query = {**auth_params, "language": "en-US", **(params or {})}

    for attempt in range(retries):
        try:
            response = await client.get(
                TMDB_BASE_URL + path,
                params=query,
                headers=headers
            )
        #network error (lose internet connection)
        except httpx.HTTPError as error:
            print(f"TMDB network error on {path}: {error!r}")
            await asyncio.sleep(1 + attempt)
            continue
        if response.status_code == 200:
            return response.json()
        if response.status_code == 401:
            raise TMDBAuthError()
        if response.status_code == 404:
            return None
        if response.status_code == 429 or response.status_code >= 500:
            wait = int(response.headers.get("Retry-After", 1 + attempt))
            await asyncio.sleep(wait)
            continue
        print(f"TMDB {response.status_code} on {path}")
        return None
    return None

#quick tmdb health check before application start doing requests

async def _preflight(client):
    """Returns None if TMDB works, otherwise a human-readable warning."""

    if not _api_key():
        return (
            "TMDB_API_KEY was not found in your .env file, so posters are "
            "missing and hours are estimated."
        )

#connecting to TMDB

    try:
        headers, params = _auth()
        response = await client.get(
            f"{TMDB_BASE_URL}/configuration",
            params=params,
            headers=headers
        )

    except httpx.HTTPError as error:
        return (
            "Could not reach TMDB (api.themoviedb.org). It may be blocked "
            "on your network - try a VPN or different DNS. Posters are "
            f"missing and hours are estimated. ({type(error).__name__})"
        )

    if response.status_code == 401:
        return (
            "TMDB rejected your API key (401). Use the 'API Key' or the "
            "'API Read Access Token' from your TMDB account settings. "
            "Posters are missing and hours are estimated."
        )

    if response.status_code != 200:
        return (
            f"TMDB returned status {response.status_code}. Posters are "
            "missing and hours are estimated."
        )

    return None

# calculates episode runtime when it isnt provide

def _fallback_runtime(show, show_runtime=None):
    if show_runtime:
        return show_runtime

    genres = show.get("genres") or []

    if "Animation" in genres:
        return RUNTIME_ANIMATION

    if "Comedy" in genres and "Drama" not in genres:
        return RUNTIME_COMEDY

    return RUNTIME_DEFAULT

#how many hours the user watched 

def _average_runtime(details):
    runtimes = [r for r in (details.get("episode_run_time") or []) if r]

    if runtimes:
        return round(sum(runtimes) / len(runtimes))

    for key in ("last_episode_to_air", "next_episode_to_air"):
        runtime = (details.get(key) or {}).get("runtime")

        if runtime:
            return runtime

    return None

#get the info for one tv show 

async def _get_show(client, cache, tmdb_id):

    key = f"show:{tmdb_id}"
    #if i already have requested
    if key in cache:
        return cache[key]
    #if it isnt cached ask tmdb
    details = await _get(client, f"/tv/{tmdb_id}")

    if not details:
        return None
    #keep info i need
    slim = {
        "poster_path": details.get("poster_path"),
        "backdrop_path": details.get("backdrop_path"),
        "runtime": _average_runtime(details)
    }

    cache[key] = slim

    return slim

#search the tmdb using title and year to find ids

async def _search_show(client, cache, title, year):
    """Fallback if the id lookup fails (should be rare)."""

    key = f"search:{title}::{year}"

    if key in cache:
        return cache[key]
    params = {"query": title}
    if year:
        params["first_air_date_year"] = year
    data = await _get(client, "/search/tv", params)

    results = (data or {}).get("results") or []

    if not results and year:
        data = await _get(client, "/search/tv", {"query": title})
        results = (data or {}).get("results") or []

    tmdb_id = None

    if results:
        best = next((r for r in results if r.get("poster_path")), results[0])
        tmdb_id = best["id"]

    cache[key] = tmdb_id

    return tmdb_id

#run time of every episode in a specific season

async def _get_season(client, cache, tmdb_id, season_number):
    """Returns {episode_number(str): runtime} or None."""

    key = f"season:{tmdb_id}:{season_number}"

    if key in cache:
        return cache[key]

    data = await _get(client, f"/tv/{tmdb_id}/season/{season_number}")

    if not data:
        return None
    #build a dictionary
    episodes = {
        str(episode.get("episode_number")): episode.get("runtime") or 0
        for episode in data.get("episodes", [])
    }
    cache[key] = episodes
    return episodes

# ENRICH ONE SHOW(find info,determine which episodes,calc total watch time)
#one show -> find tmdb show -> get poster -> check watched seasons and episodes -> get real ep runtime -> calc total hours -> return enriched show
async def _enrich_show(client, cache, show):

    stats = {"estimated": False, "matched": False}
    tmdb_id = show.get("tmdb_id")
    #if my data contains tmdb id
    details = await _get_show(client, cache, tmdb_id) if tmdb_id else None
    #if not search by title and year
    if details is None:
        found_id = await _search_show(
            client, cache, show.get("title"), show.get("year")
        )
        #id available -> yes -> get_show() -> failed -> search_show(title,year)
        if found_id:
            tmdb_id = found_id
            details = await _get_show(client, cache, tmdb_id)
    # add tmdb images
    if details:
        stats["matched"] = True
        show["poster"] = details.get("poster_path")
        show["backdrop"] = details.get("backdrop_path")
    else:
        show["poster"] = None
    #show average runtime
    show_runtime = (details or {}).get("runtime")
    fallback = _fallback_runtime(show, show_runtime)
    minutes = 0
    #Go through every watched season
    for season in show.get("watched_seasons", []):
        number = season.get("season_number")
        wanted = season.get("episodes")
        count = season.get("episode_count") or 0
        
        #Get actual episode runtimes
        season_runtimes = None
        if tmdb_id and number is not None and details:
            season_runtimes = await _get_season(
                client, cache, tmdb_id, number
            )
        if not season_runtimes:
            # No TMDB data for this season -> estimate
            stats["estimated"] = True
            episodes = count if wanted is None else len(wanted)
            minutes += episodes * fallback
            continue
        #whole season watched
        if wanted is None:
            runtimes = [r or fallback for r in season_runtimes.values()]
            # TMDB may have fewer episodes than the user's data
            if count and len(runtimes) < count:
                runtimes += [fallback] * (count - len(runtimes))
                stats["estimated"] = True
            # add the season's minutes
            minutes += sum(runtimes[:count] if count else runtimes)
        #if only specific episodes were watched
        else:
            for episode in wanted:
                minutes += season_runtimes.get(str(episode)) or fallback
    #Convert minutes to hours
    show["watched_hours"] = minutes / 60
    #Tell the frontend whether the number is estimated
    show["hours_estimated"] = stats["estimated"]
    return stats

# PUBLIC ENTRY POINT
async def enrich_all(series, transport=None):
    """
    Adds poster / backdrop / watched_hours to every show (in place).
    Returns an "enrichment" summary dict for the frontend.
    """
    cache = _load_cache()
    semaphore = asyncio.Semaphore(8)
    summary = {
        "tmdbAvailable": True,
        "matched": 0,
        "unmatched": 0,
        "estimatedHours": 0,
        "warning": None
    }

    async with httpx.AsyncClient(timeout=20.0, transport=transport) as client:
        warning = await _preflight(client)
        #If TMDB is unavailable
        if warning:
            print(f"{warning}")
            summary["tmdbAvailable"] = False
            summary["warning"] = warning
            for show in series:
                show["poster"] = None
                minutes = 0
                fallback = _fallback_runtime(show)
                #Calculate estimated hours
                for season in show.get("watched_seasons", []):
                    wanted = season.get("episodes")
                    count = season.get("episode_count") or 0
                    minutes += (
                        count if wanted is None else len(wanted)
                    ) * fallback

                show["watched_hours"] = minutes / 60
                show["hours_estimated"] = True
            summary["unmatched"] = len(series)
            summary["estimatedHours"] = len(series)
            return summary
        #track progress
        done = 0
        async def work(show):
            nonlocal done
            async with semaphore:
                try:
                    stats = await _enrich_show(client, cache, show)
                except TMDBAuthError:
                    raise
                except Exception as error:
                    print(f"{show.get('title')}: {error!r}")

                    show.setdefault("poster", None)
                    show.setdefault("watched_hours", 0)
                    stats = {"estimated": True, "matched": False}
                done += 1
                #progress info for backend console
                if done % 25 == 0:
                    print(f"   ...{done}/{len(series)} series")
                return stats
        
        #Process all shows concurrently
        try:
            results = await asyncio.gather(*(work(show) for show in series))
        except TMDBAuthError:
            summary["tmdbAvailable"] = False
            summary["warning"] = "TMDB rejected your API key (401)."
            return summary

    _save_cache(cache)
    summary["matched"] = sum(1 for r in results if r["matched"])
    summary["unmatched"] = len(results) - summary["matched"]
    summary["estimatedHours"] = sum(1 for r in results if r["estimated"])
    return summary

# SERIALIZD SERIES IMPORT

@app.post("/api/series/import")
async def import_series(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".json"):
        raise HTTPException(
            status_code=400,
            detail="Please upload a JSON file."
        )

    try:
        # READ SERIALIZD FILE
        file_content = await read_upload(file)
        series = import_serializd(
            file_content
        )
        enrichment = await enrich_all(series)
        enriched_series = series
        series_data = build_series_data(
            enriched_series,
            enrichment
        )
        return series_data
    except HTTPException:
        raise
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=400,
            detail="Invalid JSON file."
        )
    except Exception as e:
        print(
            f"Serializd import error: {e}"
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to import Serializd data."
        )