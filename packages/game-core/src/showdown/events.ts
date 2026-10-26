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
  // DAS-O-Ween 2026: SETTINGS ONLY. The real boards live in a show file outside git (ADM-01) and are loaded
  // in the console before doors; the old answers are public in git history, so the show uses new ones.
  'dasoween-2026': [],
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
