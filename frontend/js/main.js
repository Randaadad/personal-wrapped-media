const PRODUCTION_API = "";

const API_BASE = (
    window.MEDIA_WRAPPED_API ||
    (["localhost", "127.0.0.1", ""].includes(location.hostname)
        ? "http://127.0.0.1:8000"
        : PRODUCTION_API)
).replace(/\/$/, "");

let currentCategory = "home";
let currentTheme = "light";
let letterboxdData = null;

/* Series data imported by the server code that has allSeries + watchDates */
const SERIES_DATA_VERSION = 2;
let seriesImported = false;

const OUTDATED_SERIES_MESSAGE =
    "This series data came from an older import. Update " +
    "importer/serializd.py and main.py, restart the server, then " +
    "import your Serializd file again to get all series and " +
    "yearly activity.";


/* -----------SAFE STORAGE-------------- */

function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.warn(`Could not save "${key}" to localStorage:`, error);
        return false;
    }
}

function slimLetterboxd(data) {
    return {
        ...data,
        movies: (data.movies || []).map((movie) => ({
            title: movie.title,
            year: movie.year,
            letterboxd_rating: movie.letterboxd_rating,
            genres: movie.genres,
            tmdb: movie.tmdb
                ? {
                    id: movie.tmdb.id,
                    poster_path: movie.tmdb.poster_path,
                    backdrop_path: movie.tmdb.backdrop_path,
                    runtime: movie.tmdb.runtime,
                    genre_ids: movie.tmdb.genre_ids
                }
                : null
        }))
    };
}

function seriesDataOutdated() {
    return (
        seriesImported &&
        (MEDIA_DATA.series?.dataVersion || 0) < SERIES_DATA_VERSION
    );
}

function completeSeriesData(data, exportJson) {

    const shows = Array.isArray(exportJson?.shows) ? exportJson.shows : [];
    const diary = Array.isArray(exportJson?.diary) ? exportJson.diary : [];

    if (shows.length === 0 && diary.length === 0) return data;

    const key = (title) => String(title || "").toLowerCase().trim();
    const posters = {};
    [...(data.allSeries || []), ...(data.topPicks || [])].forEach((item) => {
        if (item?.title && item.poster) posters[key(item.title)] = item.poster;
    });
    const watchDates = diary
        .map((entry) => entry.backdate || entry.dateAdded)
        .filter(Boolean);

    if (watchDates.length) data.watchDates = watchDates;
    const seasonEpisodes = {};
    shows.forEach((show) =>
        (show.seasonsWatchedDetail || []).forEach((season) => {
            seasonEpisodes[`${show.showId}|${season.seasonId}`] =
                season.episodeCount || 1;
        })
    );
    data.watchWeights = diary
        .filter((entry) => entry.backdate || entry.dateAdded)
        .map((entry) => {
            if (entry.episode && entry.episode.episodeNumber != null) {
                return 1;
            }
            return (
                seasonEpisodes[
                    `${entry.showId}|${entry.season?.seasonId}`
                ] || 1
            );
        });
    if (shows.length) {
        const mean = (list) =>
            list && list.length
                ? list.reduce((a, b) => a + b, 0) / list.length
                : 0;
        data.allSeries = shows
            .map((show) => ({
                title: show.name,
                rating:
                    typeof show.rating === "number"
                        ? show.rating / 2
                        : null,
                avg: mean(show.allRatings) / 2,
                scale: 5,
                meta: (show.genres && show.genres[0]) || "Series",
                poster:
                    posters[key(show.name)] ||
                    show.bannerImage ||
                    null
            }))
            .sort(
                (a, b) =>
                    (b.rating == null ? -1 : b.rating) -
                        (a.rating == null ? -1 : a.rating) ||
                    b.avg - a.avg ||
                    String(a.title).localeCompare(String(b.title))
            );
    }
    const ratedShows = shows.filter((show) => typeof show.rating === "number");

    data.scale = 5;
    data.starsConverted = true;
    data.stats = data.stats || {};

    if (ratedShows.length) {
        data.stats.avgRating = (
            ratedShows.reduce((total, show) => total + show.rating, 0) /
            ratedShows.length /
            2
        ).toFixed(1);
    }
    if ((data.topPicks || []).length) {
        data.topPicks = data.topPicks.map((pick) => ({
            ...pick,
            rating:
                pick.scale === 5 || pick.rating == null
                    ? pick.rating
                    : pick.rating / 2,
            scale: 5
        }));
    }
    if (shows.length) {
        let episodes = 0;
        let minutes = 0;

        shows.forEach((show) => {
            const count = (show.seasonsWatchedDetail || []).reduce(
                (total, season) => total + (season.episodeCount || 0),
                0
            );

            const perEpisode = (show.genres || []).includes("Animation")
                ? 24
                : 45;

            episodes += count;
            minutes += count * perEpisode;
        });

        data.stats = data.stats || {};

        if (!(Number(data.stats.totalHours) > 0)) {
            data.stats.totalHours = Math.round(minutes / 60);
        }

        if (!(Number(data.stats.totalEpisodes) > 0)) {
            data.stats.totalEpisodes = episodes;
        }
    }

    data.dataVersion = SERIES_DATA_VERSION;

    return data;
}
function buildSeriesFromExport(exportJson) {
    const shows = exportJson?.shows || [];
    const diary = exportJson?.diary || [];
    const rated = shows.filter((show) => typeof show.rating === "number");
    const avgRating = rated.length
        ? (rated.reduce((t, show) => t + show.rating, 0) / rated.length).toFixed(1)
        : "—";
    const genreMap = {};
    shows.forEach((show) =>
        (show.genres || []).forEach((name) => {
            genreMap[name] = (genreMap[name] || 0) + 1;
        })
    );
    const genres = Object.entries(genreMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    const monthly = Array(12).fill(0);
    const daily = Array(7).fill(0);
    diary.forEach((entry) => {
        const date = new Date(entry.backdate || entry.dateAdded);
        if (Number.isNaN(date.getTime())) return;
        monthly[date.getMonth()]++;
        daily[date.getDay()]++;
    });
    const topDay = Math.max(...daily);
    const data = {
        year: new Date().getFullYear(),
        label: "Series",
        scale: 5,
        tagline: "The series you followed, rated, and remembered.",
        stats: {
            totalTitles: shows.length,
            totalHours: 0,
            totalEpisodes: 0,
            avgRating
        },
        moodLine: genres.length
            ? `You were really into ${genres[0].name.toLowerCase()} this year.`
            : "A year filled with stories worth remembering.",
        genres,
        topPicks: [],
        monthly,
        peakDay: topDay > 0 ? WEEKDAYS[daily.indexOf(topDay)] : "—"
    };
    completeSeriesData(data, exportJson);
    data.topPicks = data.allSeries.slice(0, 5).map((item) => ({
        title: item.title,
        rating: item.rating,
        genre: item.meta,
        scale: 5,
        poster: item.poster
    }));
    return data;
}
function normalizeSeriesStars(data) {
    if (!data || data.starsConverted) return data;
    const half = (value) =>
        typeof value === "number" ? value / 2 : value;
    (data.allSeries || []).forEach((show) => {
        show.rating = half(show.rating);
        show.avg = half(show.avg);
        show.scale = 5;
    });
    (data.topPicks || []).forEach((pick) => {
        pick.rating = half(pick.rating);
        pick.scale = 5;
    });
    if (data.stats && Number(data.stats.avgRating) > 0) {
        data.stats.avgRating = (Number(data.stats.avgRating) / 2).toFixed(1);
    }
    data.scale = 5;
    data.starsConverted = true;
    return data;
}

/* ====DOM ELEMENTS==== */
const themeToggle = document.getElementById("theme_toggle");
const logMediaBtn = document.getElementById("log-media-btn");
const letterboxdImport = document.getElementById("letterboxd-import");
const letterboxdZipInput = document.getElementById(
    "letterboxd-zip"
);
const importLetterboxdBtn = document.getElementById(
    "import-letterboxd-btn"
);
const closeLetterboxdImport = document.getElementById(
    "close-letterboxd-import"
);
const letterboxdImportStatus = document.getElementById(
    "letterboxd-import-status"
);
const serializdImport =
    document.getElementById("serializd-import");
const serializdJsonInput =
    document.getElementById("serializd-json");
const importSerializdBtn =
    document.getElementById("import-serializd-btn");
const closeSerializdImport =
    document.getElementById("close-serializd-import");
const serializdImportStatus =
    document.getElementById("serializd-import-status");
const notificationsBtn = document.getElementById("notifications-btn");
const notificationDot = document.getElementById("notification-dot");
const profileBtn = document.getElementById("profile-btn");
const profileAvatar = document.getElementById("profile-avatar");
const avatarFallback = document.getElementById("avatar-fallback");
const categoryLinks = document.querySelectorAll(
    ".nav_link[data-category]"
);
const logo = document.querySelector(".logo");
const heroLabel = document.getElementById("hero-label");
const heroTitle = document.getElementById("hero-title");
const heroDescription = document.getElementById("hero-description");
const totalTitles = document.getElementById("total-titles");
const totalHours = document.getElementById("total-hours");
const totalEpisodes = document.getElementById("total-episodes");
const averageRating = document.getElementById("average-rating");
const topPicksGrid = document.getElementById("top-picks-grid");
const viewAllButton = document.getElementById("view-all");
let showingAllMovies = false;
viewAllButton.addEventListener("click", () => {
    if (!showingAllMovies) {
        renderAllMovies();
        viewAllButton.textContent = "SHOW LESS";
        showingAllMovies = true;
    } else {
        renderTopPicks();
        viewAllButton.textContent = "VIEW ALL";
        showingAllMovies = false;
    }
});

const genreChartCanvas = document.getElementById("genre-chart");
const genreTotal = document.getElementById("genre-total");
const genreLegend = document.getElementById("genre-legend");

const activityChartCanvas =
    document.getElementById("activity-chart");

const peakMonth = document.getElementById("peak-month");

const peakMonthHours =
    document.getElementById("peak-month-hours");

const averageSession =
    document.getElementById("average-session");

const highlightsGrid =
    document.getElementById("highlights-grid");

const topPicksHeading =
    document.querySelector("#top-picks .section_eyebrow");

const topPicksTitle =
    document.querySelector("#top-picks .section_title");

const statisticsTitle =
    document.querySelector("#statistics .section_title");

const activityEyebrow =
    document.querySelector("#activity .section_eyebrow");

const activityTitle =
    document.querySelector("#activity .section_title");

let genreChart;
let activityChart;
let selectedActivityYear = "all";

/* ===MONTH NAMES=== */

const MONTHS = [
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
];

const SHORT_MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
];
function buildGenreData(movies) {
    const genreMap = {};

    movies.forEach((movie) => {
        (movie.genres || []).forEach((genre) => {
            if (!genreMap[genre]) {
                genreMap[genre] = 0;
            }

            genreMap[genre]++;
        });
    });

    return Object.entries(genreMap)
        .map(([name, count]) => ({
            name,
            count
        }))
        .sort((a, b) => b.count - a.count);
}

function buildMonthlyActivity(watchEvents, selectedYear = "all") {
    const monthly = Array(12).fill(0);

    watchEvents.forEach((event) => {
        if (!event.watched_at) {
            return;
        }

        const date = new Date(event.watched_at);

        if (Number.isNaN(date.getTime())) {
            return;
        }
        if (
            selectedYear !== "all" &&
            date.getFullYear() !== Number(selectedYear)
        ) {
            return;
        }

        const month = date.getMonth();

        if (month >= 0 && month < 12) {
            monthly[month]++;
        }
    });

    return monthly;
}

function getActivityYears(watchEvents) {
    return [
        ...new Set(
            watchEvents
                .filter((event) => event.watched_at)
                .map((event) => {
                    const date = new Date(event.watched_at);
                    return date.getFullYear();
                })
        )
    ].sort((a, b) => b - a);
}

const WEEKDAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
];

function getSeriesEntries() {
    const series = MEDIA_DATA.series;
    const dates = getSeriesDates();
    const weights = series?.watchWeights || [];
    const usable =
        weights.length === (series?.watchDates || []).length;

    return dates.map((value, index) => ({
        value,
        weight: usable ? weights[index] || 1 : 1
    }));
}

function getSeriesDates() {
    const series = MEDIA_DATA.series;
    if (!series) return [];

    const pick = (entry) =>
        typeof entry === "string" || typeof entry === "number"
            ? entry
            : entry?.watched_at || entry?.watchedAt || entry?.date || null;

    let dates = (series.watchDates || []).map(pick).filter(Boolean);

    if (dates.length === 0) {
        (series.allSeries || []).forEach((show) => {
            const list =
                show.watchDates || show.watch_dates || show.dates ||
                [show.watched_at || show.watchedAt || show.date];
            [].concat(list).map(pick).filter(Boolean)
                .forEach((d) => dates.push(d));
        });
    }

    return dates;
}
function getActivityEvents(category = currentCategory) {

    const movieDates = (letterboxdData?.watch_events || [])
        .map((event) => event.watched_at)
        .filter(Boolean);

    const seriesDates = getSeriesDates();

    if (category === "movies") return movieDates;
    if (category === "series") return seriesDates;

    return [...movieDates, ...seriesDates];
}
function getActivityStats() {
    const entries = (
        currentCategory === "series"
            ? getSeriesEntries()
            : getActivityEvents().map((value) => ({ value, weight: 1 }))
    )
        .map((entry) => ({
            date: new Date(entry.value),
            weight: entry.weight
        }))
        .filter((entry) => !Number.isNaN(entry.date.getTime()));

    const dates = entries.map((entry) => entry.date);

    if (dates.length === 0) {
        const data = getCurrentData() || {};
        const values = data.monthly || Array(12).fill(0);
        const peak = Math.max(...values);
        const index = values.indexOf(peak);

        return {
            labels: SHORT_MONTHS,
            values,
            peakLabel: peak > 0 ? MONTHS[index] : "—",
            peakValue: peak,
            peakDay: data.peakDay || "—"
        };
    }

    const year = selectedActivityYear;

    const inRange =
        year === "all"
            ? entries
            : entries.filter(
                (entry) => entry.date.getFullYear() === Number(year)
            );

    const daily = Array(7).fill(0);

    inRange.forEach((entry) => {
        daily[entry.date.getDay()] += entry.weight;
    });

    const topDay = Math.max(...daily);

    const peakDay =
        topDay > 0 ? WEEKDAYS[daily.indexOf(topDay)] : "—";

    let labels = [];
    let values = [];
    let fullLabels = [];

    if (year === "all") {

        const times = inRange.map((entry) => entry.date.getTime());

        const first = new Date(Math.min(...times));
        const last = new Date(Math.max(...times));

        const counts = {};

        inRange.forEach((entry) => {
            const key =
                entry.date.getFullYear() * 12 + entry.date.getMonth();
            counts[key] = (counts[key] || 0) + entry.weight;
        });

        for (
            let key = first.getFullYear() * 12 + first.getMonth();
            key <= last.getFullYear() * 12 + last.getMonth();
            key++
        ) {
            const y = Math.floor(key / 12);
            const m = key % 12;

            labels.push(`${SHORT_MONTHS[m]} '${String(y).slice(2)}`);
            fullLabels.push(`${MONTHS[m]} ${y}`);
            values.push(counts[key] || 0);
        }

    } else {

        labels = SHORT_MONTHS;
        fullLabels = MONTHS;
        values = Array(12).fill(0);

        inRange.forEach((entry) => {
            values[entry.date.getMonth()] += entry.weight;
        });
    }

    const peakValue = values.length ? Math.max(...values) : 0;

    return {
        labels,
        values,
        peakLabel:
            peakValue > 0
                ? fullLabels[values.indexOf(peakValue)]
                : "—",
        peakValue,
        peakDay
    };
}

function redrawActivity() {
    renderActivityChart();
    renderActivityInfo();
    renderHighlights();
}

function setupActivityFilter() {

    const filter = document.getElementById("activity-year-filter");

    if (!filter) return;

    const years = [
        ...new Set(
            getActivityEvents()
                .map((value) => new Date(value))
                .filter((date) => !Number.isNaN(date.getTime()))
                .map((date) => date.getFullYear())
        )
    ].sort((a, b) => b - a);

    filter.innerHTML = "";

    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "ALL";
    filter.appendChild(allOption);

    years.forEach((year) => {
        const option = document.createElement("option");
        option.value = year;
        option.textContent = year;
        filter.appendChild(option);
    });

    if (
        selectedActivityYear !== "all" &&
        !years.includes(Number(selectedActivityYear))
    ) {
        selectedActivityYear = "all";
    }

    filter.value = String(selectedActivityYear);

    filter.onchange = () => {
        selectedActivityYear = filter.value;
        redrawActivity();
    };
}

function buildMoviesData(letterboxdData) {

    const movies =letterboxdData.movies || [];

    const watchEvents =letterboxdData.watch_events || [];

    const genres = buildGenreData(movies);


    // =======BASIC STATISTICS===========

    const watchedTitles = new Set();

    watchEvents.forEach((event) => {

        if (!event.watched_at || !event.title) {
            return;
        }

        watchedTitles.add(
            event.title
                .toLowerCase()
                .trim()
        );
    });

    const totalTitles = movies.length;

    const totalMinutes = movies.reduce(
        (total, movie) =>
            total + (movie.tmdb?.runtime || 0),
        0
    );

    const totalHours = Math.round(totalMinutes / 60);

    console.log(
        "Letterboxd movies loaded:",
        movies.length
    );

    console.log(
        "First Letterboxd movie:",
        movies[0]
    );


    const ratedMovies =
        movies.filter(
            (movie) =>
                movie.letterboxd_rating !== null
        );


    const totalRating =
        ratedMovies.reduce(
            (total, movie) =>
                total + movie.letterboxd_rating,
            0
        );


    const avgRating =
        ratedMovies.length > 0
            ? (
                totalRating /
                ratedMovies.length
            ).toFixed(1)
            : "—";

    // TOP PICKS

    const topPicks =
        [...ratedMovies]
            .sort(
                (a, b) =>
                    b.letterboxd_rating - a.letterboxd_rating
            )
            .slice(0, 5)
            .map((movie) => ({
                title: movie.title,
                rating: movie.letterboxd_rating,
                genre: "Movie",
                scale: 5,
                poster: movie.tmdb?.poster_path || null
            }))
    // MONTHLY ACTIVITY
    const monthly = buildMonthlyActivity(watchEvents, "all");
    // PEAK MONTH
    const highestMonth =
        Math.max(...monthly);
    const peakMonthIndex =
        monthly.indexOf(
            highestMonth
        );
    const peakMonth =
        highestMonth > 0
            ? MONTHS[peakMonthIndex]
            : "—";
    const DAYS = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday"
    ];
    const dailyActivity = Array(7).fill(0);
    watchEvents.forEach((event) => {
        if (!event.watched_at) {
            return;
        }
        const date = new Date(event.watched_at);
        const day = date.getDay();
        dailyActivity[day]++;
    });
    const highestDay = Math.max(...dailyActivity);
    const peakDayIndex =
        dailyActivity.indexOf(highestDay);
    const peakDay =
        highestDay > 0
            ? DAYS[peakDayIndex]
            : "—";
    // RETURN MOVIE DATA
    return {
        year: 2026,
        label: "Movies",
        tagline:
            "The movies you watched, rated, and remembered.",
        stats: {
            totalTitles,
            totalHours,
            avgRating
        },
        moodLine:
            genres.length > 0
                ? `You were really into ${genres[0].name.toLowerCase()} this year.`
                : "A year filled with stories worth remembering.",
            
        peakMonth,
        peakDay,
        topPicks,
        genres: genres,
        monthly,
        daily: dailyActivity
    };
}
function getHomeData() {
    const categories = [
        MEDIA_DATA.movies,
        MEDIA_DATA.series
    ].filter(Boolean);

    /*Basic statistics */
    const totalTitlesValue = categories.reduce(
        (total, category) =>
            total + (category.stats.totalTitles || 0),
        0
    );

    const totalHoursValue = categories.reduce(
        (total, category) =>
            total + (category.stats.totalHours || 0),
        0
    );

    const totalEpisodesValue = categories.reduce(
        (total, category) =>
            total + (category.stats.totalEpisodes || 0),
        0
    );
    let ratingPoints = 0;
    let ratingTitles = 0;

    categories.forEach((category) => {

        const titles = category.stats.totalTitles || 0;
        const rating =
            ((Number(category.stats.avgRating) || 0) /
                (category.scale || 5)) * 5;

        ratingPoints += titles * rating;
        ratingTitles += titles;
    });

    const averageRatingValue =
        ratingTitles > 0
            ? (ratingPoints / ratingTitles).toFixed(1)
            : "—";


    /*Combine top picks */
    const combinedTopPicks = getRankedItems("home")
        .slice(0, 5)
        .map((item) => ({
            title: item.title,
            rating: item.rating,
            genre: item.meta,
            scale: item.scale,
            poster: item.poster
        }));

    /*Combine genres*/
    const genreMap = {};
    categories.forEach((category) => {
        (category.genres || []).forEach((genre) => {
            if (!genreMap[genre.name]) {
                genreMap[genre.name] = 0;
            }
            genreMap[genre.name] += genre.count;
        });
    });
    const combinedGenres = Object.entries(genreMap)
        .map(([name, count]) => ({
            name,
            count
        }))
        .sort((a, b) => b.count - a.count);

    /*Combine monthly activity*/
    const combinedMonthly = Array(12).fill(0);
    categories.forEach((category) => {
        category.monthly.forEach((value, index) => {
            combinedMonthly[index] += value;
        });
    });
    const combinedDaily = Array(7).fill(0);
    categories.forEach((category) => {
        if (!category.daily) {
            return;
        }
        category.daily.forEach((value, index) => {
            combinedDaily[index] += value;
        });
    });
    const highestDay = Math.max(...combinedDaily);
    const peakDayIndex = combinedDaily.indexOf(highestDay);
    const DAYS = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday"
    ];
    const combinedPeakDay =
        highestDay > 0
            ? DAYS[peakDayIndex]
            : "—";
    /*Find peak month*/
    const highestMonth =
        Math.max(...combinedMonthly);
    const peakMonthIndex =
        combinedMonthly.indexOf(highestMonth);
    const combinedPeakMonth =
        peakMonthIndex !== -1
            ? MONTHS[peakMonthIndex]
            : "—";
    return {
        year: 2026,
        label: "Media Journey",
        tagline:
            "A year of movies, series, and the stories that stayed with you.",
        stats: {
            totalTitles: totalTitlesValue,
            totalHours: totalHoursValue,
            totalEpisodes: totalEpisodesValue,
            avgRating: averageRatingValue
        },
        moodLine:
            "A year filled with stories, characters, and worlds worth remembering.",
        peakMonth: combinedPeakMonth,
        peakDay: combinedPeakDay,
        topPicks: combinedTopPicks,
        genres: combinedGenres,
        monthly: combinedMonthly
    };
}


/*GET CURRENT DATA*/

function getCurrentData() {
    normalizeSeriesStars(MEDIA_DATA.series);
    if (currentCategory === "home") {
        return getHomeData();
    }
    return MEDIA_DATA[currentCategory];
}
/*HERO*/

function renderHero() {
    const data = getCurrentData();
    if (!data) return;
    heroLabel.textContent =
        `Your ${data.year}`;
    heroTitle.textContent =
        data.label.toUpperCase();
    heroDescription.textContent =
        data.tagline;
    const fmt = (value) =>
        typeof value === "number" ? value.toLocaleString() : value;
    totalTitles.textContent =
        fmt(data.stats.totalTitles);
    totalHours.textContent =
        fmt(data.stats.totalHours);
    totalEpisodes.textContent =
        fmt(data.stats.totalEpisodes ?? "—");
    const hoursNote = document.getElementById("hours-note");
    if (hoursNote) {
        const hours = Number(data.stats.totalHours) || 0;
        hoursNote.textContent =
            hours >= 48 ? `about ${Math.round(hours / 24)} days` : "";
    }
    renderHeroPosters();
    averageRating.textContent =
        data.stats.avgRating;
}
/*TOP PICKS*/
function renderTopPicks() {
    const data = getCurrentData();
    if (!data) return;
    topPicksGrid.innerHTML = "";
    const picks =
        currentCategory === "movies" || currentCategory === "series"
            ? getRankedItems(currentCategory)
                .slice(0, 5)
                .map((item) => ({
                    title: item.title,
                    rating: item.rating,
                    genre: item.meta,
                    poster: item.poster
                }))
            : data.topPicks;
    picks.forEach((pick, index) => {
        const card = document.createElement("article");
        card.classList.add("media_card");
        const poster = pick.poster
            ? `
                <img
                    class="media_card_poster"
                    src="https://image.tmdb.org/t/p/w500${pick.poster}"
                    alt="${pick.title} poster"
                    loading="lazy"
                    onerror="this.remove()">`: "";
        card.innerHTML = `
            <span class="media_card_number">
                ${String(index + 1).padStart(2, "0")}
            </span>
            <div class="media_card_content">
                ${poster}
                <h3 class="media_card_title">
                    ${formatTitle(pick.title)}
                </h3>
            </div>
            <div class="media_card_info">
                <p class="media_card_name">
                    ${pick.title}
                </p>
                <p class="media_card_rating">
                    ★ ${pick.rating}
                </p>
                <p class="media_card_meta">
                    ${pick.genre}
                </p>
            </div>`;
        topPicksGrid.appendChild(card);
    });
}
function getRankedItems(category = currentCategory) {
    normalizeSeriesStars(MEDIA_DATA.series);
    const movies = (letterboxdData?.movies || []).map((movie) => ({
        title: movie.title,
        rating: movie.letterboxd_rating,
        meta: "Movie",
        poster: movie.tmdb?.poster_path || null,
        scale: 5,
        avg: 0,
        group: 0
    }));
    const seriesList =
        (MEDIA_DATA.series?.allSeries?.length
            ? MEDIA_DATA.series.allSeries
            : MEDIA_DATA.series?.topPicks) ||
        [];
    const series = seriesList.map((show) => ({
        title: show.title,
        rating: show.rating,
        meta: show.meta || show.genre || "Series",
        poster: show.poster || null,
        scale: show.scale || 5,
        avg: show.avg || 0,
        group: 1
    }));
    const score = (item) =>
        item.rating == null ? -1 : item.rating / item.scale;
    const byQuality = (a, b) =>
        score(b) - score(a) || (b.avg || 0) - (a.avg || 0);
    movies.sort(byQuality);
    series.sort(byQuality);
    if (category === "movies") return movies;
    if (category === "series") return series;
    const seen = {};
    [...movies, ...series].forEach((item) => {
        const key = `${item.group}|${score(item)}`;
        item.slot = seen[key] = (seen[key] ?? -1) + 1;
    });
    return [...movies, ...series].sort(
        (a, b) =>
            score(b) - score(a) ||
            a.slot - b.slot ||
            a.group - b.group
    );
}
function getAllItems() {
    return getRankedItems(currentCategory);
}
function renderAllMovies() {
    const items = getAllItems();
    topPicksGrid.innerHTML = "";
    items.forEach((item, index) => {
        const card = document.createElement("article");
        card.classList.add("media_card");
        card.innerHTML = `
            <span class="media_card_number">
                ${String(index + 1).padStart(2, "0")}
            </span>
            <div class="media_card_content">
                ${
                    item.poster
                        ? `<img
                                class="media_card_poster"
                                src="https://image.tmdb.org/t/p/w342${item.poster}"
                                alt="${item.title} poster"
                                loading="lazy"
                                onerror="this.remove()">`: ""
                }
                <h3 class="media_card_title">
                    ${formatTitle(item.title)}
                </h3>
            </div>
            <div class="media_card_info">
                <p class="media_card_name">
                    ${item.title}
                </p>
                <p class="media_card_rating">
                    ★ ${item.rating ?? "—"}
                </p>
                <p class="media_card_meta">
                    ${item.meta}
                </p>
            </div>
        `;
        topPicksGrid.appendChild(card);
    });
}

function formatTitle(title) {
    const words = title.split(" ");
    return words.join(" ");
}
/*GENRE LEGEND*/
function renderGenreLegend() {
    const data = getCurrentData();
    if (!data) return;
    genreLegend.innerHTML = "";
    const colors =
        currentTheme === "dark"
            ? CHART_COLORS.dark
            : CHART_COLORS.light;
    data.genres.forEach((genre, index) => {
        const item =
            document.createElement("div");
        item.classList.add("genre_item");
        const color =
            colors.genres[
                index % colors.genres.length
            ];
        item.innerHTML = `
            <span
                class="genre_color"
                style="background: ${color}"
            ></span>
            <span class="genre_name">
                ${genre.name}
            </span>
            <span class="genre_count">
                ${genre.count}
            </span>`;
        genreLegend.appendChild(item);
    });
    genreTotal.textContent = data.stats.totalTitles;
}
/*GENRE CHART*/

function renderGenreChart() {
    const data = getCurrentData();
    if (!data || !genreChartCanvas) return;
    const genres = data.genres;
    if (genreChart) {
        genreChart.destroy();
    }
    const colors =
        currentTheme === "dark"
            ? CHART_COLORS.dark
            : CHART_COLORS.light;
    genreChart =
        new Chart(
            genreChartCanvas,
            {
                type: "doughnut",
                data: {
                    labels:
                        genres.map(
                            (genre) => genre.name
                        ),
                    datasets: [
                        {
                            data:
                                genres.map(
                                    (genre) => genre.count
                                ),
                            backgroundColor:
                                genres.map(
                                    (_, index) =>
                                        colors.genres[
                                            index %
                                            colors.genres.length
                                        ]
                                ),
                            borderWidth: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio:
                        false,
                    cutout: "72%",
                    plugins: {
                        legend: {
                            display: false
                        }
                    }
                }
            }
        );
}
/*MONTHLY ACTIVITY*/

function renderActivityChart() {
    const stats = getActivityStats();
    if (!activityChartCanvas) {
        return;
    }
    const colors =
        currentTheme === "dark"
            ? CHART_COLORS.dark
            : CHART_COLORS.light;
    const peakIndex = stats.values.indexOf(stats.peakValue);
    if (activityChart) {
        activityChart.destroy();
        activityChart = null;
    }
    const existingChart = Chart.getChart(activityChartCanvas);
    if (existingChart) {
        existingChart.destroy();
    }
    activityChart = new Chart(activityChartCanvas, {
        type: "bar",
        data: {
            labels: stats.labels,
            datasets: [
                {
                    data: [...stats.values],
                    backgroundColor: stats.values.map(
                        (value, index) =>
                            index === peakIndex && value > 0
                                ? colors.monthPeak
                                : colors.monthBar
                    ),
                    borderRadius: 0,
                    borderSkipped: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: colors.tickColor
                    },
                    border: {
                        display: false
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: colors.gridLine
                    },
                    ticks: {
                        color: colors.tickColor
                    },
                    border: {
                        display: false
                    }
                }
            }
        }
    });
}

/*ACTIVITY INFORMATION*/
function renderActivityInfo() {
    const stats = getActivityStats();
    const unit =
        currentCategory === "movies"
            ? "titles"
            : currentCategory === "series"
                ? "episodes"
                : "logs";
    peakMonth.textContent = stats.peakLabel;
    peakMonthHours.textContent =
        stats.peakValue > 0
            ? `${stats.peakValue} ${unit}`
            : "";
    averageSession.textContent = stats.peakDay;
}

/*HIGHLIGHTS*/
function renderHighlights() {
    const data = getCurrentData();
    if (!data) return;
    const activity = getActivityStats();
    const highlights = [
        {
            label: "YOUR MOOD",
            title: data.moodLine,
            type: "mood"
        },
        {
            label: "PEAK MONTH",
            title: activity.peakLabel,
            type: "month"
        },
        {
            label: "MOST ACTIVE DAY",
            title: activity.peakDay,
            type: "day"
        },
        {
            label: "TOTAL HOURS",
            title: `${data.stats.totalHours} hours`,
            type: "hours"
        },
        {
            label: "AVERAGE RATING",
            title: `${data.stats.avgRating} / ${data.scale || 5}`,
            type: "rating"
        }
    ];
    highlightsGrid.innerHTML = "";
    highlights.forEach(
        (highlight) => {
            const card =
                document.createElement(
                    "article"
                );
            card.classList.add(
                "highlight_card"
            );
            card.innerHTML = `
                <div class="highlight_visual highlight_visual_${highlight.type}">
                    ${
                        highlight.type === "mood"
                            ?`<span class= "highlight_mood_visual">
                                ${data.genres[0]?.name || "-"}
                            </span>`
                            : highlight.type === "month"
                            ? `<span class="highlight_month_visual">
                                ${highlight.title}
                                </span>`
                            : highlight.type === "day"
                            ? `<span class="highlight_day_visual">
                                ${highlight.title}
                                </span>`
                            : highlight.type === "hours"
                            ? `<span class="highlight_hours_visual">
                                ${data.stats.totalHours}
                                <small>HOURS</small>
                                </span>`
                            : highlight.type === "rating"
                            ? `<span class="highlight_rating_visual">
                                ${data.stats.avgRating}
                                <small>/ ${data.scale || 5}</small>
                                </span>`: ""
                    }
                </div>
                <div class="highlight_content">
                    <p class="highlight_label">
                        ${highlight.label}
                    </p>
                    <h3 class="highlight_title">
                        ${highlight.title}
                    </h3>
                </div>`;
            highlightsGrid.appendChild(card);
        }
    );
}
/*UPDATE SECTION TEXT*/

function updateSectionText() {
    if (currentCategory === "home") {
        if (topPicksHeading) {
            topPicksHeading.textContent =
                "01 — YOUR TOP PICKS";
        }
        if (topPicksTitle) {
            topPicksTitle.textContent =
                "TOP PICKS";
        }
        if (statisticsTitle) {
            statisticsTitle.textContent =
                "The stories you kept coming back to.";
        }
        if (activityEyebrow) {
            activityEyebrow.textContent =
                "YOUR WATCHING HABITS";
        }
        if (activityTitle) {
            activityTitle.textContent =
                "MONTHLY ACTIVITY";
        }
        if (viewAllButton) {
            viewAllButton.textContent =
                "VIEW ALL";
        }
    } else {
        const label =
            currentCategory.toUpperCase();
        if (topPicksHeading) {
            topPicksHeading.textContent =
                `01 — YOUR TOP ${label}`;
        }
        if (topPicksTitle) {
            topPicksTitle.textContent =
                "TOP PICKS";
        }
        if (statisticsTitle) {
            statisticsTitle.textContent =
                "The stories you kept coming back to.";
        }
        if (activityEyebrow) {
            activityEyebrow.textContent =
                "YOUR WATCHING HABITS";
        }
        if (activityTitle) {
            activityTitle.textContent =
                "MONTHLY ACTIVITY";
        }
    }
}

function hasUserData() {
    return Boolean(letterboxdData) || seriesImported;
}
function updateEmptyState() {
    const anchor = document.getElementById("top-picks");
    const content = anchor?.parentElement;
    if (!content) return;
    if (!document.getElementById("empty-state-style")) {
        const style = document.createElement("style");
        style.id = "empty-state-style";
        style.textContent = `
            .is-empty > :not(#welcome):not(.letterboxd_import):not(.serializd_import) { display: none !important; }
            #welcome[hidden], #clear-data[hidden] { display: none !important; }
            #welcome { max-width: 760px; margin: 12vh auto; padding: 0 24px; text-align: left; }
            #welcome .welcome_eyebrow { font-size: 13px; letter-spacing: .12em; opacity: .65; margin: 0 0 16px; }
            #welcome h2 { font-family: inherit; font-weight: 400; font-size: clamp(34px, 6vw, 60px); line-height: 1.05; margin: 0 0 20px; }
            #welcome p { font-size: 16px; line-height: 1.6; opacity: .75; margin: 0 0 32px; max-width: 560px; }
            #welcome .welcome_actions { display: flex; flex-wrap: wrap; gap: 16px; }
            #welcome button, #clear-data { font: inherit; color: inherit; background: transparent; border: 1px solid currentColor; padding: 16px 24px; cursor: pointer; letter-spacing: .08em; font-size: 13px; text-transform: uppercase; }
            #welcome button:hover, #clear-data:hover { opacity: .65; }
            #clear-data { display: block; margin: 48px auto; border-color: transparent; border-bottom-color: currentColor; padding: 6px 2px; opacity: .55; }
        `;
        document.head.appendChild(style);
    }
    let welcome = document.getElementById("welcome");
    if (!welcome) {
        welcome = document.createElement("section");
        welcome.id = "welcome";
        welcome.innerHTML = `
            <p class="welcome_eyebrow">YOUR MEDIA WRAPPED</p>
            <h2>Upload your data to see your year.</h2>
            <p>
                Add your Letterboxd export and your Serializd export and
                we will turn them into your top picks, genres, monthly
                activity and highlights. Your files are processed once and
                are not saved on our server. Your results stay in this
                browser.
            </p>
            <div class="welcome_actions">
                <button type="button" class="open-import" data-import="movies">
                    Upload Letterboxd ZIP
                </button>
                <button type="button" class="open-import" data-import="series">
                    Upload Serializd JSON
                </button>
            </div>`;
        content.insertBefore(welcome, content.firstChild);
    }
    if (!welcome.dataset.bound) {
        welcome.dataset.bound = "1";
        welcome.querySelectorAll(".open-import").forEach((button) => {
            button.addEventListener("click", () => {
                const movies = button.dataset.import === "movies";
                if (letterboxdImport) letterboxdImport.hidden = !movies;
                if (serializdImport) serializdImport.hidden = movies;
            });
        });
    }
    let clear = document.getElementById("clear-data");
    if (!clear) {
        clear = document.createElement("button");
        clear.id = "clear-data";
        clear.type = "button";
        clear.textContent = "Clear my data";
        clear.addEventListener("click", () => {
            if (
                !confirm(
                    "Remove your movies and series from this browser?"
                )
            ) {
                return;
            }
            ["letterboxdData", "serializdData", "currentCategory"]
                .forEach((key) => localStorage.removeItem(key));
            location.reload();
        });
        content.appendChild(clear);
    }
    const empty = !hasUserData();
    content.classList.toggle("is-empty", empty);
    document.documentElement.classList.toggle("has-data", !empty);
    welcome.hidden = !empty;
    clear.hidden = empty;
}
/*CATEGORY SWITCHING */

function switchCategory(category) {
    updateEmptyState();
    if (category === "home" && !hasUserData()) {
        currentCategory = "home";
        categoryLinks.forEach((link) =>
            link.classList.toggle("active", link.dataset.category === "home")
        );
        return;
    }
    if (category !== "home" && !MEDIA_DATA[category]) {
        console.log(
            `No data available for "${category}" yet.`
        );
        if (category === "movies") {
            if (letterboxdImport) {
                letterboxdImport.hidden = false;
            }
        }
        if (category === "series") {
            if (serializdImport) {
                serializdImport.hidden = false;
            }
        }
        return;
    }
    currentCategory = category;
    localStorage.setItem("currentCategory", category);
    showingAllMovies = false;
    if (viewAllButton) viewAllButton.textContent = "VIEW ALL";
    setupActivityFilter();
    renderHero();
    renderTopPicks();
    renderGenreLegend();
    renderGenreChart();
    renderActivityChart();
    renderActivityInfo();
    renderHighlights();
    updateSectionText();
    categoryLinks.forEach(link => {
        link.classList.toggle(
            "active",
            link.dataset.category === category
        );
    });
    if (logo) {
        if (category === "home") {
            logo.classList.add("active");
        } else {
            logo.classList.remove("active");
        }
    }
}
/*CATEGORY NAVIGATION*/

categoryLinks.forEach(
    (link) => {
        link.addEventListener(
            "click",
            (event) => {
                event.preventDefault();
                const category =
                    link.dataset.category;
                switchCategory(
                    category
                );
            }
        );
    }
);
/*LOGO → HOME*/

if (logo) {
    logo.addEventListener(
        "click",
        (event) => {
            event.preventDefault();
            switchCategory("home");
        }
    );
}
/*DARK / LIGHT THEME*/

function toggleTheme() {
    currentTheme =
        currentTheme === "light"
            ? "dark"
            : "light";
    document.documentElement.setAttribute(
        "data-theme",
        currentTheme
    );

    renderGenreLegend();
    renderGenreChart();
    renderActivityChart();

    /*Update theme icon.*/

    themeToggle.textContent =
        currentTheme === "dark"
            ? "☾"
            : "☀";
}

themeToggle.addEventListener(
    "click",
    toggleTheme
);

logMediaBtn?.addEventListener("click", () => {
    if (currentCategory === "movies") {
        letterboxdImport.hidden = false;
        serializdImport.hidden = true;
    }

    if (currentCategory === "series") {
        serializdImport.hidden = false;
        letterboxdImport.hidden = true;
    }

    /* Home: open whichever import is still missing
       (movies first); if both are done, let them re-import movies. */
    if (currentCategory === "home") {
        const openMovies = !letterboxdData || seriesImported;
        letterboxdImport.hidden = !openMovies;
        serializdImport.hidden = openMovies;
    }
});

closeLetterboxdImport?.addEventListener("click", () => {
    letterboxdImport.hidden = true;
});

importLetterboxdBtn?.addEventListener(
    "click",
    async () => {
        const file = letterboxdZipInput?.files?.[0];
        if (!file) {
            letterboxdImportStatus.textContent =
                "Please select your Letterboxd ZIP file.";
            return;
        }
        if (!file.name.toLowerCase().endsWith(".zip")) {
            letterboxdImportStatus.textContent =
                "Please select a ZIP file.";
            return;
        }
        const formData = new FormData();
        formData.append("file", file);
        letterboxdImportStatus.textContent =
            "Importing your Letterboxd data...";
        importLetterboxdBtn.disabled = true;
        try {
            const response = await fetch(
                `${API_BASE}/api/movies/import`,
                {
                    method: "POST",
                    body: formData
                }
            );
            const data = await response.json();
            if (!response.ok) {
                throw new Error(
                    data.detail ||
                    "Failed to import Letterboxd data."
                );
            }
            letterboxdData = data;
            safeSetItem(
                "letterboxdData",
                JSON.stringify(slimLetterboxd(letterboxdData))
            );
            MEDIA_DATA.movies =
                buildMoviesData(letterboxdData);
            letterboxdImportStatus.textContent =
                `Successfully imported ${letterboxdData.movies.length} movies.`;
            switchCategory("movies");
            letterboxdImport.hidden = true;
        } catch (error) {
            console.error(
                "Letterboxd import failed:",
                error
            );
            letterboxdImportStatus.textContent =
                error.message ||
                "Failed to import Letterboxd data.";
        } finally {
            importLetterboxdBtn.disabled = false;
        }
    }
);

closeSerializdImport?.addEventListener("click", () => {
    serializdImport.hidden = true;
});

importSerializdBtn?.addEventListener(
    "click",
    async () => {
        const file =
            serializdJsonInput?.files?.[0];
        if (!file) {
            serializdImportStatus.textContent =
                "Please select your Serializd JSON file.";
            return;
        }
        if (
            !file.name
                .toLowerCase()
                .endsWith(".json")
        ) {
            serializdImportStatus.textContent =
                "Please select a JSON file.";
            return;
        }
        const formData = new FormData();
        formData.append(
            "file",
            file
        );
        serializdImportStatus.textContent =
            "Importing your Serializd data...";
        importSerializdBtn.disabled = true;
        try {
            const exportJson = JSON.parse(await file.text());
            let data;
            try {
                const response = await fetch(
                    `${API_BASE}/api/series/import`,
                    {
                        method: "POST",
                        body: formData
                    }
                );
                data = await response.json();
                if (!response.ok) {
                    throw new Error(
                        data.detail ||
                        "Failed to import Serializd data."
                    );
                }
                completeSeriesData(data, exportJson);
            } catch (serverError) {
                console.warn(
                    "Server import failed, reading the file directly:",
                    serverError
                );
                data = buildSeriesFromExport(exportJson);
            }
            MEDIA_DATA.series = data;
            seriesImported = true;
            const savedOk = safeSetItem(
                "serializdData",
                JSON.stringify(data)
            );
            const enrichment = data.enrichment || {};
            serializdImportStatus.textContent =
                seriesDataOutdated()
                    ? "Imported, but your server is still running OLD code. " + OUTDATED_SERIES_MESSAGE
                : enrichment.warning
                    ? `Imported your series, but: ${enrichment.warning}`
                    : enrichment.unmatched > 0
                        ? `Imported your series (${enrichment.unmatched} could not be matched on TMDB).`
                        : "Successfully imported your series.";
            if (!savedOk) {
                serializdImportStatus.textContent +=
                    " (Browser storage is full, so this will not be remembered after you close the page.)";
            }
            switchCategory("series");
            if (!enrichment.warning && !seriesDataOutdated()) {
                serializdImport.hidden = true;
            }
        } catch (error) {
            console.error(
                "Serializd import failed:",
                error
            );
            serializdImportStatus.textContent =
                error.message ||
                "Failed to import Serializd data.";
        } finally {
            importSerializdBtn.disabled = false;
        }
    }
);
document.addEventListener("click", (event) => {
    if (event.target.closest("#log-media-btn, .nav_link, .logo, #view-all, .open-import")) return;
    [letterboxdImport, serializdImport].forEach((dialog) => {
        if (dialog && !dialog.hidden && !dialog.contains(event.target)) {
            dialog.hidden = true;
        }
    });
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        if (letterboxdImport) letterboxdImport.hidden = true;
        if (serializdImport) serializdImport.hidden = true;
    }
});
function setAvatar(imageUrl, initials = "MW") {
    if (avatarFallback) {
        avatarFallback.textContent = initials;
        avatarFallback.hidden = false;
    }
    if (!profileAvatar) return;
    if (imageUrl) {
        profileAvatar.src = imageUrl;
        profileAvatar.hidden = false;
        profileAvatar.onload = () => avatarFallback && (avatarFallback.hidden = true);
        profileAvatar.onerror = () => { profileAvatar.hidden = true; };
    }
}
/*INITIALIZE*/

async function initializeApp() {

    try {
        delete MEDIA_DATA.movies;
        delete MEDIA_DATA.series;
        delete MEDIA_DATA.anime;

        document
            .querySelectorAll('.nav_link[data-category="anime"]')
            .forEach((link) => {
                (link.closest("li") || link).hidden = true;
            });

        const savedMoviesData =
            localStorage.getItem("letterboxdData");

        if (savedMoviesData) {
            letterboxdData = JSON.parse(savedMoviesData);

        MEDIA_DATA.movies =
            buildMoviesData(letterboxdData);

        setupActivityFilter(
            letterboxdData.watch_events || []
        );
    }

    const savedSeriesData =
        localStorage.getItem("serializdData");

    if (savedSeriesData) {

        MEDIA_DATA.series =
            normalizeSeriesStars(JSON.parse(savedSeriesData));

        safeSetItem(
            "serializdData",
            JSON.stringify(MEDIA_DATA.series)
        );

        seriesImported = true;

    }

        const savedCategory =
            localStorage.getItem("currentCategory") || "home";

        switchCategory(savedCategory);
    
    document.documentElement.setAttribute(
        "data-theme",
        currentTheme
    );

    }

    catch(error){
        console.error(
            "failed to load Media Wrapped data:",
            error
        );
    }

}

initializeApp();


/* ---------- HERO POSTERS ---------- */

function renderHeroPosters() {
    const box = document.getElementById("hero-posters");
    if (!box) return;
    box.innerHTML = "";
    const picks = getRankedItems(currentCategory)
        .filter((item) => item.poster)
        .slice(0, 3);
    picks.forEach((item) => {
        const img = document.createElement("img");
        img.className = "hero_poster";
        img.src = `https://image.tmdb.org/t/p/w342${item.poster}`;
        img.alt = `${item.title} poster`;
        img.onerror = () => img.remove();
        box.appendChild(img);
    });
    box.closest(".hero_illustration")
        ?.classList.toggle("has-posters", picks.length > 0);
}


/* ---------- IMPORT DROP ZONES ---------- */

function setupDropzone(zoneId, inputId, nameId, buttonId, extension) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    const nameEl = document.getElementById(nameId);
    const button = document.getElementById(buttonId);
    if (!zone || !input || !nameEl || !button) return;

    const refresh = () => {
        const file = input.files?.[0];
        nameEl.textContent = file
            ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`
            : "No file chosen";
        zone.classList.toggle("has-file", Boolean(file));
        button.classList.toggle("needs-file", !file);
    };

    input.addEventListener("change", refresh);

    ["dragenter", "dragover"].forEach((name) =>
        zone.addEventListener(name, (event) => {
            event.preventDefault();
            zone.classList.add("is-over");
        })
    );
    ["dragleave", "drop"].forEach((name) =>
        zone.addEventListener(name, (event) => {
            event.preventDefault();
            zone.classList.remove("is-over");
        })
    );
    zone.addEventListener("drop", (event) => {
        const file = event.dataTransfer?.files?.[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(extension)) {
            nameEl.textContent = `Please choose a ${extension} file`;
            return;
        }
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        refresh();
    });

    refresh();
}

setupDropzone("letterboxd-drop", "letterboxd-zip",
    "letterboxd-file-name", "import-letterboxd-btn", ".zip");
setupDropzone("serializd-drop", "serializd-json",
    "serializd-file-name", "import-serializd-btn", ".json");