const MEDIA_DATA = {

movies: {
    year: 2026,
    label: "Movie Journey",
    tagline: "A year of stories, scenes and characters.",

    stats: {
    totalTitles:   80,   
    totalHours:    142,  
    avgRating:     8.7,  
    uniqueGenres:  14,   
    },

    moodLine: "A little dark, a little strange, always story-first.",

    peakMonth: "July",
    peakDay:   "Friday",

    topPicks: [
    { title: "Dune: Part Two",    rating: 9.5, genre: "Sci-Fi"},
    { title: "Perfect Days",      rating: 9.2, genre: "Drama"},
    { title: "Interstellar",      rating: 9.8, genre: "Sci-Fi"},
    { title: "The Pianist",       rating: 9.0, genre: "Drama"},
    { title: "Spirited Away",     rating: 9.6, genre: "Fantasy"},
    ],

    genres: [
    { name: "Drama",     count: 28 },
    { name: "Sci-Fi",    count: 18 },
    { name: "Thriller",  count: 14 },
    { name: "Fantasy",   count: 10 },
    { name: "Action",    count:  9 },
    { name: "Mystery",   count:  8 },
    ],

    monthly: [4, 6, 5, 8, 7, 9, 6, 10, 8, 7, 12, 5],

    palette: [
    { label: "First Day"},
    { label: "Unexpected favorite"},
    { label: "Best rewatched"},
    { label: "Most emotional"},
    { label: "Last watched"},
    ],
},


series: {
    year: 2026,
    label: "Series Journey",
    tagline: "New worlds, familiar faces, unforgettable stories.",

    stats: {
    totalTitles:   20,
    totalHours:    428,
    totalEpisodes: 312,
    avgRating:     8.4,
    },

    moodLine: "The shortest you kept coming back to.",

    peakMonth: "November",
    peakDay:   "As a binge",

    topPicks: [
    { title: "Breaking Bad",      rating: 9.9, genre: "Crime"},
    { title: "Shadow and Bone",   rating: 8.2, genre: "Fantasy"},
    { title: "Chernobyl",         rating: 9.7, genre: "Drama"},
    { title: "The Last of Us",    rating: 9.5, genre: "Drama"},
    { title: "Stranger Things",   rating: 8.8, genre: "Sci-Fi"},
    ],

    genres: [
    { name: "Drama",     count: 9  },
    { name: "Fantasy",   count: 5  },
    { name: "Crime",     count: 4  },
    { name: "Sci-Fi",    count: 3  },
    { name: "Comedy",    count: 2  },
    ],

    monthly: [1, 2, 1, 3, 2, 2, 1, 3, 2, 2, 3, 1],

    palette: [
    { label: "First Day"},
    { label: "Biggest plot twist"},
    { label: "Best rewatched"},
    { label: "Most emotional"},
    { label: "Last watched"},
    ],
},

anime: {
    year: 2026,
    label: "Anime Journey",
    tagline: "Every arc ending, theme, every tear.",

    stats: {
    totalTitles:   42,
    totalHours:    612,
    totalEpisodes: 198,
    avgRating:     8.9,
    },

    moodLine: "Big feelings, bigger worlds, always a little emotional.",

    peakMonth: "November",
    peakDay:   "Sunday",

    topPicks: [
    { title: "Frieren",           rating: 9.8, genre: "Fantasy"},
    { title: "Attack on Titan",   rating: 9.9, genre: "Action"},
    { title: "Jujutsu Kaisen",    rating: 9.2, genre: "Action"},
    { title: "Vinland Saga",      rating: 9.5, genre: "Drama"},
    { title: "Spy x Family",      rating: 8.7, genre: "Comedy"},
    ],

    genres: [
    { name: "Action",    count: 14 },
    { name: "Fantasy",   count: 12 },
    { name: "Drama",     count: 9  },
    { name: "Comedy",    count: 4  },
    { name: "Romance",   count: 3  },
    ],

    monthly: [3, 4, 3, 4, 3, 4, 3, 4, 4, 3, 5, 4],

    palette: [
    { label: "First Day"},
    { label: "Unexpected favorite"},
    { label: "Best arc"},
    { label: "Most emotional"},
    { label: "Last watched"},
    ],
},

};

const CHART_COLORS = {
dark: {
    genres:     ["#8A7A9A", "#6A8A7A", "#9A7A6A", "#7A8A9A", "#8A9A7A", "#9A8A7A"],
    monthBar:   "#5A5A5A",
    monthPeak:  "#C9A87C",
    gridLine:   "rgba(255,255,255,0.05)",
    tickColor:  "#6b6860",
    background: "transparent",
},
light: {
    genres:     ["#7A6A8A", "#5A7A6A", "#8A6A5A", "#6A7A8A", "#7A8A6A", "#8A7A6A"],
    monthBar:   "#C8C4BC",
    monthPeak:  "#8b6f3e",  
    gridLine:   "rgba(0,0,0,0.06)",
    tickColor:  "#9a9590",
    background: "transparent",
},
};
