/**
 * Bundled facts, written for this project in our own words. A fact is not copyrightable; each one
 * names where the figure comes from so it can be checked.
 */
export interface Fact {
  readonly text: string;
  readonly source: string;
}

export const FACTS: readonly Fact[] = [
  {
    text: "A day on Venus lasts longer than its year: the planet turns once every 243 Earth days and circles the Sun in 225.",
    source: "NASA Solar System Exploration, Venus",
  },
  { text: "A year on Mercury lasts only 88 Earth days.", source: "NASA Solar System Exploration, Mercury" },
  {
    text: "Venus is hotter than Mercury even though Mercury is closer to the Sun, because its thick carbon dioxide air traps heat.",
    source: "NASA Solar System Exploration, Venus",
  },
  { text: "Light from the Sun takes about 8 minutes and 20 seconds to reach Earth.", source: "NASA Science, Sun facts" },
  { text: "The Moon moves away from Earth by about 3.8 centimetres every year.", source: "NASA, Apollo lunar laser ranging" },
  {
    text: "Olympus Mons on Mars stands about 22 kilometres high, roughly two and a half times the height of Everest above sea level.",
    source: "NASA Solar System Exploration, Mars",
  },
  { text: "A Pluto year lasts about 248 Earth years, so Pluto has not finished one orbit since its discovery in 1930.", source: "NASA Solar System Exploration, Pluto" },
  { text: "The Sun holds about 99.86 percent of all the mass in the solar system.", source: "NASA Solar System Exploration, Sun" },
  {
    text: "Octopuses have three hearts: two send blood through the gills and one sends it around the rest of the body.",
    source: "Encyclopaedia Britannica, Octopus",
  },
  { text: "In botany a banana is a berry and a strawberry is not.", source: "Encyclopaedia Britannica, Berry" },
  {
    text: "Wombat droppings are cube-shaped, a form their intestines mould as the waste dries.",
    source: "Yang et al., Soft Matter, 2021",
  },
  {
    text: "Honey bees tell nestmates where food is with a waggle dance: its angle points the way and its length signals the distance.",
    source: "Karl von Frisch, Nobel Prize lecture, 1973",
  },
  {
    text: "Some tardigrades survived ten days in the vacuum of low Earth orbit in a 2007 experiment.",
    source: "Jonsson et al., Current Biology, 2008",
  },
  { text: "Sharks are older than trees: sharks date back over 400 million years, the first trees about 385 million.", source: "Natural History Museum, London" },
  { text: "Most of your red blood cells are replaced about every four months.", source: "Encyclopaedia Britannica, Red blood cell" },
  { text: "Sound travels about four times faster through water than through air.", source: "NOAA Ocean Service" },
  { text: "A lightning bolt heats the air around it to roughly 28,000 degrees Celsius, about five times the surface of the Sun.", source: "NOAA National Weather Service" },
  {
    text: "Antarctica counts as a desert: most of the continent receives less than 200 millimetres of precipitation a year.",
    source: "National Snow and Ice Data Center",
  },
  { text: "Bamboo can grow 91 centimetres in a single day.", source: "Guinness World Records, fastest-growing plant" },
  { text: "The Eiffel Tower can stand up to 15 centimetres taller in summer, when heat expands its iron.", source: "Eiffel Tower, official site" },
  { text: "Russia spans eleven time zones.", source: "Encyclopaedia Britannica, Russia" },
  { text: "Greenland, at about 2.17 million square kilometres, is the largest island that is not a continent.", source: "Encyclopaedia Britannica, Greenland" },
  {
    text: "The Anglo-Zanzibar War of 27 August 1896 is the shortest recorded war: it was over in under an hour.",
    source: "Encyclopaedia Britannica, Anglo-Zanzibar War",
  },
  {
    text: "Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.",
    source: "Encyclopaedia Britannica, Cleopatra and Pyramids of Giza",
  },
];
