/**
 * Bundled quotes. Every author died before 1930 and every text is in the public domain; where an
 * English translation is quoted, the translation is public domain too and named in `work`.
 */
export interface Quote {
  readonly text: string;
  readonly author: string;
  /** Title and, for translations, translator and year. */
  readonly work: string;
}

export const QUOTES: readonly Quote[] = [
  { text: "Hold every hour in your grasp.", author: "Seneca", work: "Letters to Lucilius, trans. R. M. Gummere, 1917" },
  { text: "We suffer more often in imagination than in reality.", author: "Seneca", work: "Letters to Lucilius, trans. R. M. Gummere, 1917" },
  {
    text: "Such as are thy habitual thoughts, such also will be the character of thy mind; for the soul is dyed by the thoughts.",
    author: "Marcus Aurelius",
    work: "Meditations, trans. George Long, 1862",
  },
  {
    text: "Men are disturbed, not by things, but by the principles and notions which they form concerning things.",
    author: "Epictetus",
    work: "Enchiridion, trans. Elizabeth Carter, 1758",
  },
  { text: "Our life is frittered away by detail.", author: "Henry David Thoreau", work: "Walden, 1854" },
  { text: "Rather than love, than money, than fame, give me truth.", author: "Henry David Thoreau", work: "Walden, 1854" },
  {
    text: "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach.",
    author: "Henry David Thoreau",
    work: "Walden, 1854",
  },
  { text: "Nothing can bring you peace but yourself.", author: "Ralph Waldo Emerson", work: "Self-Reliance, 1841" },
  { text: "To be great is to be misunderstood.", author: "Ralph Waldo Emerson", work: "Self-Reliance, 1841" },
  { text: "Well done is better than well said.", author: "Benjamin Franklin", work: "Poor Richard's Almanack, 1737" },
  { text: "Lost time is never found again.", author: "Benjamin Franklin", work: "Poor Richard's Almanack, 1748" },
  { text: "I am large, I contain multitudes.", author: "Walt Whitman", work: "Song of Myself, 1881" },
  { text: "Hope is the thing with feathers that perches in the soul.", author: "Emily Dickinson", work: "Poems, 1891" },
  { text: "To see a World in a Grain of Sand / And a Heaven in a Wild Flower", author: "William Blake", work: "Auguries of Innocence, c. 1803" },
  { text: "To strive, to seek, to find, and not to yield.", author: "Alfred, Lord Tennyson", work: "Ulysses, 1842" },
  {
    text: "To travel hopefully is a better thing than to arrive, and the true success is to labour.",
    author: "Robert Louis Stevenson",
    work: "Virginibus Puerisque, 1881",
  },
  { text: "All the world's a stage, and all the men and women merely players.", author: "William Shakespeare", work: "As You Like It, c. 1599" },
  { text: "This above all: to thine own self be true.", author: "William Shakespeare", work: "Hamlet, c. 1600" },
  { text: "I declare after all there is no enjoyment like reading!", author: "Jane Austen", work: "Pride and Prejudice, 1813" },
  { text: "I will honour Christmas in my heart, and try to keep it all the year.", author: "Charles Dickens", work: "A Christmas Carol, 1843" },
  { text: "We are all in the gutter, but some of us are looking at the stars.", author: "Oscar Wilde", work: "Lady Windermere's Fan, 1892" },
  { text: "Always do right. This will gratify some people and astonish the rest.", author: "Mark Twain", work: "Note to the Young People's Society, 1901" },
  { text: "The journey of a thousand li commences with a single step.", author: "Lao Tzu", work: "Tao Te Ching, trans. James Legge, 1891" },
  {
    text: "Learning without thought is labour lost; thought without learning is perilous.",
    author: "Confucius",
    work: "Analects, trans. James Legge, 1861",
  },
  { text: "Little friends may prove great friends.", author: "Aesop", work: "Fables, trans. G. F. Townsend, 1867" },
  { text: "If I have seen further it is by standing on the shoulders of Giants.", author: "Isaac Newton", work: "Letter to Robert Hooke, 1675" },
  {
    text: "The Analytical Engine weaves algebraical patterns just as the Jacquard loom weaves flowers and leaves.",
    author: "Ada Lovelace",
    work: "Notes on the Analytical Engine, 1843",
  },
  {
    text: "Nothing will ever be attempted, if all possible objections must be first overcome.",
    author: "Samuel Johnson",
    work: "Rasselas, 1759",
  },
  { text: "Life is short, and Art long.", author: "Hippocrates", work: "Aphorisms, trans. Francis Adams, 1849" },
  { text: "Il faut cultiver notre jardin.", author: "Voltaire", work: "Candide, 1759" },
  { text: "The mountains are calling and I must go.", author: "John Muir", work: "Letter to Sarah Muir Galloway, 1873" },
];

/** Longest text that still reads well in the circular widget. */
export const SHORT_QUOTE_LIMIT = 56;

/**
 * Parses one line of a user's own list: `text | author`. Without a bar the whole line is the text.
 * Returns null for a blank line.
 */
export function parseCustomQuote(line: string): Quote | null {
  const [textPart = "", ...rest] = line.split("|");
  const text = textPart.trim();
  if (text === "") return null;
  const author = rest.join("|").trim();
  return { text, author: author === "" ? "Saved by you" : author, work: "" };
}
