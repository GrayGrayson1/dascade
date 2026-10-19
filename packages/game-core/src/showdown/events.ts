/**
 * Event presets: ready-made Presenter Showcase rounds the presenter loads with one click (the
 * settings each preset applies are public metadata in @dascade/shared/games/showdown).
 *
 * SERVER-ONLY CONTENT, like the packs: these are hidden answers, so the web client never imports
 * this file. Loading a preset copies its rounds into the room's custom rounds; from there they are
 * ordinary custom rounds (the presenter can edit and save them, and they reach only the presenter).
 *
 * The rankings are curated host picks, NOT a survey or poll, and every round says so in its
 * attribution ("According to DAS-O-Ween Host Picks…"). The presenter can change the attribution and
 * the order in the round editor before the show.
 */
import type { ShowdownEventId, ShowdownRoundInput } from '@dascade/shared/games/showdown';

type A = [text: string, note: string, aliases?: string[]];

function top10(prompt: string, title: string, answers: A[], special = 5): ShowdownRoundInput {
  return {
    prompt,
    title,
    source: 'DAS-O-Ween Host Picks',
    special,
    // Ranked: every answer at 0 points keeps the order given (#1 first).
    answers: answers.map(([text, note, aliases]) => ({ text, points: 0, note, aliases: aliases ?? [] })),
  };
}

export const SHOWDOWN_EVENT_ROUNDS: Record<ShowdownEventId, ShowdownRoundInput[]> = {
  'dasoween-2026': [
    top10('Name the Top 10 Halloween Songs.', 'Halloween Songs', [
      ['Thriller', 'Michael Jackson', ['thriler', 'michael jackson']],
      ['Monster Mash', 'Bobby “Boris” Pickett', ['the monster mash', 'monster mash song']],
      ['Ghostbusters', 'Ray Parker Jr.', ['ghost busters', 'who you gonna call']],
      ['This Is Halloween', 'The Nightmare Before Christmas', ['this is halloween song', 'nightmare before christmas']],
      ['The Time Warp', 'The Rocky Horror Picture Show', ['time warp', 'lets do the time warp again', 'rocky horror']],
      ['Somebody’s Watching Me', 'Rockwell', ['somebodys watching me', 'somebody watching me']],
      ['Werewolves of London', 'Warren Zevon', ['werewolves', 'werewolf of london']],
      ['Purple People Eater', 'Sheb Wooley', ['the purple people eater', 'people eater']],
      ['I Put a Spell on You', 'Screamin’ Jay Hawkins', ['put a spell on you', 'i put a spell on u']],
      ['(Don’t Fear) The Reaper', 'Blue Öyster Cult', ['dont fear the reaper', 'the reaper', 'more cowbell']],
    ]),
    top10('Name the Top 10 Halloween Movies.', 'Halloween Movies', [
      ['Halloween', '1978', ['halloween 1978', 'michael myers']],
      ['Hocus Pocus', '1993', ['hocus-pocus', 'sanderson sisters']],
      ['The Nightmare Before Christmas', '1993', ['nightmare before christmas', 'jack skellington']],
      ['Beetlejuice', '1988', ['beetle juice', 'betelgeuse']],
      ['Ghostbusters', '1984', ['ghost busters']],
      ['The Addams Family', '1991', ['addams family', 'adams family']],
      ['Scream', '1996', ['ghostface']],
      ['Casper', '1995', ['casper the friendly ghost']],
      ['The Exorcist', '1973', ['exorcist']],
      ['A Nightmare on Elm Street', '1984', ['nightmare on elm street', 'freddy krueger', 'freddy']],
    ]),
  ],
  // Practice boards: the same show, with answers that don't spoil the real ones.
  'dasoween-rehearsal': [
    top10('Name the Top 10 Halloween Candies.', 'Practice: Candy', [
      ['Peanut Butter Cups', 'Chocolate + peanut butter', ['reeses', 'peanut butter cup', 'reese’s']],
      ['Candy Corn', 'Love it or hate it', ['candycorn']],
      ['Chocolate Bar', 'Any brand', ['chocolate', 'candy bar']],
      ['Gummy Worms', 'Wiggly', ['gummies', 'gummy bears']],
      ['Caramel Apple', 'Sticky', ['caramel apples', 'candy apple']],
      ['Lollipop', 'On a stick', ['lollipops', 'sucker']],
      ['Jelly Beans', 'Every flavour', ['jellybeans']],
      ['Licorice', 'Red or black', ['liquorice', 'twizzlers']],
      ['Sour Candy', 'Pucker up', ['sour patch', 'sours']],
      ['Bubble Gum', 'Pop!', ['gum', 'bubblegum']],
    ]),
    top10('Name the Top 10 Halloween Costumes.', 'Practice: Costumes', [
      ['Witch', 'Pointy hat', ['witches']],
      ['Vampire', 'Fangs', ['dracula']],
      ['Ghost', 'A bedsheet', ['ghosts']],
      ['Zombie', 'Braaains', ['zombies']],
      ['Superhero', 'Cape optional', ['super hero']],
      ['Pirate', 'Arr', ['pirates']],
      ['Skeleton', 'Bones', ['skeletons']],
      ['Black Cat', 'Ears and a tail', ['cat']],
      ['Mummy', 'Toilet paper', ['mummies']],
      ['Pumpkin', 'Round and orange', ['jack o lantern']],
    ]),
  ],
};
